use actix_web::{web, HttpResponse};
use ethers::{
    contract::abigen,
    providers::{Http, Middleware, Provider},
    types::Address,
};
use serde::Serialize;
use std::sync::Arc;

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
