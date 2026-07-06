use actix_web::{web, HttpResponse};
use ethers::types::{Address, U256};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::str::FromStr;

use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::AppState;

/// Records one row in the G$ ledger. Best-effort — a failed insert here must
/// never roll back or fail the caller's real on-chain/DB work that already
/// happened, so errors are logged and swallowed like the rest of this codebase's
/// background chain-write call sites.
pub async fn insert_ledger_entry(
    db: &sqlx::PgPool,
    wallet: &str,
    category: &str,
    amount: Decimal,
    tx_hash: Option<&str>,
    counterparty: Option<&str>,
) {
    let result = sqlx::query(
        "INSERT INTO g_ledger (wallet_address, category, amount, tx_hash, counterparty)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(wallet)
    .bind(category)
    .bind(amount)
    .bind(tx_hash)
    .bind(counterparty)
    .execute(db)
    .await;

    if let Err(e) = result {
        tracing::error!("Failed to record g_ledger entry ({} {} {}): {}", wallet, category, amount, e);
    }
}

// ── GET /relay-address ─────────────────────────────────────────────────────────
// Public (addresses aren't secret) — the frontend needs this as the `spender`
// in the EIP-2612 permit it signs for a transfer-out.
pub async fn get_relay_address(state: web::Data<AppState>) -> HttpResponse {
    match state.chain.as_ref() {
        Some(chain) => HttpResponse::Ok().json(json!({ "address": format!("{:?}", chain.relay_address()) })),
        None => HttpResponse::ServiceUnavailable().json(json!({"error": "Chain relay not available"})),
    }
}

fn wei_to_g(amount: U256) -> Decimal {
    Decimal::from_str(&amount.to_string()).unwrap_or(Decimal::ZERO) / Decimal::from(10u64.pow(18))
}

// ── GET /players/:wallet/ledger-summary ───────────────────────────────────────
#[derive(Serialize)]
pub struct LedgerSummary {
    #[serde(with = "rust_decimal::serde::float")]
    pub ubi_earned: Decimal,
    #[serde(with = "rust_decimal::serde::float")]
    pub gameplay_earned: Decimal,
    #[serde(with = "rust_decimal::serde::float")]
    pub marketplace_spent: Decimal,
    #[serde(with = "rust_decimal::serde::float")]
    pub transferred_out: Decimal,
}

pub async fn get_ledger_summary(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    let row: Option<(Decimal, Decimal, Decimal, Decimal)> = sqlx::query_as(
        "SELECT
            COALESCE(SUM(amount) FILTER (WHERE category = 'ubi_claim'), 0),
            COALESCE(SUM(amount) FILTER (WHERE category = 'battle_reward'), 0),
            COALESCE(SUM(amount) FILTER (WHERE category = 'marketplace_purchase'), 0),
            COALESCE(SUM(amount) FILTER (WHERE category = 'transfer_out'), 0)
         FROM g_ledger WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    let (ubi_earned, gameplay_earned, marketplace_spent, transferred_out) =
        row.unwrap_or((Decimal::ZERO, Decimal::ZERO, Decimal::ZERO, Decimal::ZERO));

    HttpResponse::Ok().json(LedgerSummary {
        ubi_earned,
        gameplay_earned,
        marketplace_spent,
        transferred_out,
    })
}

// ── POST /players/:wallet/daily-claim ─────────────────────────────────────────
// (body extension only — the claim-cooldown logic itself lives in players.rs::daily_claim)
#[derive(Deserialize)]
pub struct DailyClaimLedgerBody {
    pub amount: Option<String>,
    pub tx_hash: Option<String>,
}

pub async fn record_ubi_claim(db: &sqlx::PgPool, wallet: &str, body: &DailyClaimLedgerBody) {
    let Some(amount_str) = body.amount.as_deref() else { return };
    let Ok(amount) = Decimal::from_str(amount_str) else { return };
    if amount <= Decimal::ZERO {
        return;
    }
    insert_ledger_entry(db, wallet, "ubi_claim", amount, body.tx_hash.as_deref(), None).await;
}

// ── POST /players/:wallet/transfer ────────────────────────────────────────────
// Transfers G$ out to any destination wallet. The player signs an EIP-2612
// permit off-chain granting the backend's hot wallet a one-time allowance for
// the exact amount they signed; this endpoint just relays that permit +
// transferFrom on-chain (Valor never custodies G$ — see chain.rs::transfer_g_for).
#[derive(Deserialize)]
pub struct TransferRequest {
    pub to: String,
    pub amount_wei: String,
    pub deadline: u64,
    pub v: u8,
    pub r: String,
    pub s: String,
}

pub async fn transfer_out(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<TransferRequest>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    if !is_valid_wallet(&body.to) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid destination address"}));
    }

    let from: Address = match wallet.parse() {
        Ok(a) => a,
        Err(_) => return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"})),
    };
    let to: Address = body.to.parse().expect("validated by is_valid_wallet above");

    let amount: U256 = match U256::from_dec_str(&body.amount_wei) {
        Ok(a) if !a.is_zero() => a,
        _ => return HttpResponse::BadRequest().json(json!({"error": "Invalid amount"})),
    };

    let chain = match state.chain.as_ref() {
        Some(c) => c,
        None => {
            return HttpResponse::ServiceUnavailable().json(json!({"error": "Chain relay not available"}))
        }
    };

    let hash = match chain
        .transfer_g_for(from, to, amount, body.deadline, body.v, &body.r, &body.s)
        .await
    {
        Ok(h) => h,
        Err(e) => {
            tracing::warn!("transfer-out failed for {}: {}", wallet, e);
            return HttpResponse::BadRequest().json(json!({"error": e}));
        }
    };
    let hash_str = format!("{:?}", hash);

    insert_ledger_entry(
        &state.db,
        &wallet,
        "transfer_out",
        wei_to_g(amount),
        Some(&hash_str),
        Some(&normalize_wallet(&body.to)),
    )
    .await;

    tracing::info!("Transfer-out confirmed: {} -> {} amount={} tx={}", wallet, body.to, amount, hash_str);

    HttpResponse::Ok().json(json!({
        "success": true,
        "tx_hash": hash_str,
    }))
}
