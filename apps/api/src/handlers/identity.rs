use actix_web::{web, HttpRequest, HttpResponse};
use ethers::{
    contract::abigen,
    providers::{Http, Middleware, Provider},
    types::Address,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

use crate::utils::normalize_wallet;
use crate::AppState;

#[derive(Serialize)]
pub struct VerifyResponse {
    verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    face_verify_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

abigen!(
    GoodDollarIdentity,
    r#"[
        function getWhitelistedRoot(address account) external view returns (address)
    ]"#
);

// GoodDollar's IdentityV2 contract on Celo mainnet. Same address the frontend's
// citizen-sdk resolves for `env: 'production'` (apps/web/src/lib/gooddollar.ts,
// via @goodsdks/citizen-sdk's chainConfigs[CELO].contracts.production.identityContract).
const CELO_IDENTITY_CONTRACT: &str = "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42";

/// Ground truth for "has GoodDollar ever verified this wallet is a unique
/// human" — read directly from their IdentityV2 contract on Celo, exactly the
/// way the frontend's own pre-check does it (checkWhitelistStatusReadOnly in
/// apps/web/src/lib/gooddollar.ts, via citizen-sdk's getWhitelistedRoot). A
/// non-zero returned "root" address means whitelisted; zero means not.
///
/// This used to call a REST endpoint (`GOOD_DOLLAR_API_URL`, defaulting to
/// `https://gooddollar-api.gooddollar.org`) that does not resolve in DNS at
/// all — every call failed, so this always returned `None`, and every caller
/// below treats `None` as "not verified" (`.unwrap_or(false)`, fail-closed by
/// design so an API outage can't be used to bypass verification). The result
/// was that POST /players rejected every brand-new signup, legitimate or not,
/// from the moment the check went live (2026-08-16) — confirmed by zero new
/// `players` rows in the 48+ hours since. Reading on-chain instead removes
/// the dependency on that dead host entirely and matches the one check that
/// was actually working (the frontend's).
pub async fn check_gooddollar_whitelisted(wallet: &str) -> Option<bool> {
    let account: Address = wallet.parse().ok()?;

    let rpc_url = std::env::var("CELO_RPC_URL").unwrap_or_else(|_| "https://forno.celo.org".into());
    let provider = Provider::<Http>::try_from(rpc_url.as_str())
        .map_err(|e| tracing::warn!("GoodDollar identity check: bad RPC URL {}: {}", rpc_url, e))
        .ok()?;

    let contract_addr: Address = std::env::var("GOODDOLLAR_IDENTITY_CONTRACT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| CELO_IDENTITY_CONTRACT.parse().expect("valid const address"));

    let contract = GoodDollarIdentity::new(contract_addr, Arc::new(provider));
    match contract.get_whitelisted_root(account).call().await {
        Ok(root) => Some(root != Address::zero()),
        Err(e) => {
            tracing::warn!("GoodDollar on-chain whitelist check failed for {}: {}", wallet, e);
            None
        }
    }
}

pub async fn verify_identity(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner().to_lowercase();

    // Fast path: player already has a character in our DB → already verified
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT wallet_address FROM players WHERE LOWER(wallet_address) = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    if existing.is_some() {
        return HttpResponse::Ok().json(VerifyResponse {
            verified: true,
            face_verify_url: None,
            error: None,
        });
    }

    let whitelisted = check_gooddollar_whitelisted(&wallet).await;

    match whitelisted {
        Some(true) => HttpResponse::Ok().json(VerifyResponse {
            verified: true,
            face_verify_url: None,
            error: None,
        }),
        Some(false) => {
            // Generate face verification URL
            // In production the frontend generates this via citizen-sdk generateFVLink.
            // The backend provides it as a fallback for server-side checks.
            let fv_url = format!(
                "https://app.gooddollar.org/face-verification?account={}",
                wallet
            );
            HttpResponse::Ok().json(VerifyResponse {
                verified: false,
                face_verify_url: Some(fv_url),
                error: None,
            })
        }
        None => {
            tracing::warn!("GoodDollar whitelist check failed for {}", wallet);
            HttpResponse::Ok().json(VerifyResponse {
                verified: false,
                face_verify_url: None,
                error: Some(
                    "Could not verify with GoodDollar. Please try again or use the frontend verification flow.".into()
                ),
            })
        }
    }
}

#[derive(Deserialize)]
pub struct RecordVerificationRequest {
    pub wallet_address: String,
}

// ── POST /identity/verified ──────────────────────────────────────────────────
// Records that a wallet passed GoodDollar verification through Valor's own
// onboarding, independent of whether it ever goes on to claim a character.
// Before this, verification left no trace anywhere unless the wallet later
// created a player row — a real gap for retention/funnel analysis, since
// "verified but never claimed" is exactly the population that gap hid.
//
// The frontend calls this every time IdentityVerification.tsx sees a positive
// whitelist result — including on repeat visits from an already-verified
// wallet, since that screen re-checks on every mount. Idempotency lives here,
// not the client: ON CONFLICT DO NOTHING means only the FIRST call for a
// wallet, ever, does anything, so repeat visits are a no-op single-row read.
//
// Re-verifies server-side rather than trusting the client's claim — same rule
// as every other identity gate in this codebase (see check_gooddollar_whitelisted
// callers): the client can assert anything, the whitelist is the only signal.
pub async fn record_verification(
    req: HttpRequest,
    state: web::Data<AppState>,
    body: web::Json<RecordVerificationRequest>,
) -> HttpResponse {
    let ip = req.connection_info().realip_remote_addr().unwrap_or("unknown").to_string();
    if !state.battle_limiter.check(&format!("record_verification:{}", ip)) {
        return HttpResponse::TooManyRequests().json(json!({"error": "Too many requests. Slow down."}));
    }

    let wallet = normalize_wallet(&body.wallet_address);
    let Ok(account) = wallet.parse::<Address>() else {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    };

    if !check_gooddollar_whitelisted(&wallet).await.unwrap_or(false) {
        return HttpResponse::Forbidden().json(json!({"error": "Wallet is not GoodDollar-verified"}));
    }

    let claimed = sqlx::query(
        "INSERT INTO identity_verifications (wallet_address) VALUES ($1) ON CONFLICT (wallet_address) DO NOTHING",
    )
    .bind(&wallet)
    .execute(&state.db)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);

    // Already recorded on a previous call (or a previous device/session) —
    // nothing new happened, so nothing new gets written on-chain either.
    if claimed == 0 {
        return HttpResponse::Ok().json(json!({"recorded": true, "new": false}));
    }

    // On-chain write is best-effort and off the request path: the frontend does
    // not wait on a chain tx to advance past this screen. The DB row (already
    // committed above) is the source of truth for "did this wallet verify" —
    // the chain tx is a secondary trace, so a relay/RPC failure here never
    // costs the wallet its verified-count.
    if let Some(chain) = state.chain.as_ref().cloned() {
        let db = state.db.clone();
        tokio::spawn(async move {
            if let Some(hash) = chain.record_verification(account).await {
                let tx_hash = format!("{:?}", hash);
                let _ = sqlx::query("UPDATE identity_verifications SET chain_tx = $1 WHERE wallet_address = $2")
                    .bind(&tx_hash)
                    .bind(&wallet)
                    .execute(&db)
                    .await;
            }
        });
    }

    HttpResponse::Ok().json(json!({"recorded": true, "new": true}))
}
