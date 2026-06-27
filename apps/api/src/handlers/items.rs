use actix_web::{web, HttpResponse};
use ethers::types::Address;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::AppState;
use crate::models::item::Item;
use crate::utils::normalize_wallet;

pub async fn list_items(state: web::Data<AppState>) -> HttpResponse {
    let result = sqlx::query_as::<_, Item>(
        "SELECT * FROM items WHERE price_g > 0 ORDER BY price_g ASC",
    )
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(items) => HttpResponse::Ok().json(items),
        Err(e) => {
            tracing::error!("Failed to fetch items: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Failed to fetch items"}))
        }
    }
}

// ── POST /items/:id/purchase ──────────────────────────────────────────────────
// Internal/admin endpoint — records inventory without a G$ check.
// The relay endpoint below is the user-facing purchase path.
#[derive(Deserialize)]
pub struct PurchaseRequest {
    pub wallet_address: String,
}

pub async fn purchase_item(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
    body: web::Json<PurchaseRequest>,
) -> HttpResponse {
    let item_id = path.into_inner();
    let wallet  = normalize_wallet(&body.wallet_address);

    let item = sqlx::query_as::<_, Item>("SELECT * FROM items WHERE id = $1")
        .bind(item_id)
        .fetch_optional(&state.db)
        .await;

    let item = match item {
        Ok(Some(i)) => i,
        Ok(None) => return HttpResponse::NotFound().json(json!({"error": "Item not found"})),
        Err(_) => return HttpResponse::InternalServerError().json(json!({"error": "Database error"})),
    };

    if let Some(remaining) = item.remaining_supply {
        if remaining <= 0 {
            return HttpResponse::Conflict().json(json!({"error": "Item sold out"}));
        }
    }

    let inv_result = sqlx::query(
        "INSERT INTO inventory (wallet_address, item_id, equipped, acquired_at)
         VALUES ($1, $2, false, now())
         ON CONFLICT (wallet_address, item_id) DO NOTHING",
    )
    .bind(&wallet)
    .bind(item_id)
    .execute(&state.db)
    .await;

    if inv_result.is_err() {
        return HttpResponse::InternalServerError().json(json!({"error": "Failed to record purchase"}));
    }

    let _ = sqlx::query(
        "UPDATE items SET remaining_supply = GREATEST(0, remaining_supply - 1) WHERE id = $1",
    )
    .bind(item_id)
    .execute(&state.db)
    .await;

    HttpResponse::Ok().json(json!({ "success": true, "item_id": item_id }))
}

// ── POST /items/:id/purchase-relay ────────────────────────────────────────────
// User-facing on-chain purchase via EIP-2612 permit relay.
// Frontend signs a permit (no CELO gas), backend submits purchaseWithPermit on-chain.
#[derive(Deserialize)]
pub struct RelayPurchaseRequest {
    pub wallet_address: String,
    pub deadline: u64,
    pub v: u8,
    pub r: String,
    pub s: String,
}

pub async fn purchase_item_relay(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
    body: web::Json<RelayPurchaseRequest>,
) -> HttpResponse {
    let item_id = path.into_inner();
    let wallet  = normalize_wallet(&body.wallet_address);

    // Fetch item — need on_chain_id for the marketplace call
    let item = sqlx::query_as::<_, Item>("SELECT * FROM items WHERE id = $1")
        .bind(item_id)
        .fetch_optional(&state.db)
        .await;

    let item = match item {
        Ok(Some(i)) => i,
        Ok(None) => return HttpResponse::NotFound().json(json!({"error": "Item not found"})),
        Err(_) => return HttpResponse::InternalServerError().json(json!({"error": "Database error"})),
    };

    let on_chain_id = match item.on_chain_id {
        Some(id) => id as u64,
        None => return HttpResponse::UnprocessableEntity()
            .json(json!({"error": "Item not registered on-chain"})),
    };

    if let Some(remaining) = item.remaining_supply {
        if remaining <= 0 {
            return HttpResponse::Conflict().json(json!({"error": "Item sold out"}));
        }
    }

    // Guard against double-purchase
    let already_owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM inventory WHERE wallet_address = $1 AND item_id = $2)",
    )
    .bind(&wallet)
    .bind(item_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if already_owned {
        return HttpResponse::Conflict().json(json!({"error": "Already owned"}));
    }

    // Chain relay — buyer already signed a permit; we submit purchaseWithPermit
    let chain = match state.chain.as_ref() {
        Some(c) => c,
        None => return HttpResponse::ServiceUnavailable()
            .json(json!({"error": "Chain relay not available"})),
    };

    let buyer: Address = match wallet.parse() {
        Ok(a) => a,
        Err(_) => return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"})),
    };

    let tx_hash = match chain
        .purchase_item_for(buyer, on_chain_id, body.deadline, body.v, &body.r, &body.s)
        .await
    {
        Ok(hash) => format!("{:?}", hash),
        Err(e) => {
            tracing::warn!("purchase relay failed for {}: {}", wallet, e);
            return HttpResponse::BadRequest().json(json!({"error": e}));
        }
    };

    // Record inventory + decrement supply now that the chain confirmed
    let _ = sqlx::query(
        "INSERT INTO inventory (wallet_address, item_id, equipped, acquired_at)
         VALUES ($1, $2, false, now())
         ON CONFLICT (wallet_address, item_id) DO NOTHING",
    )
    .bind(&wallet)
    .bind(item_id)
    .execute(&state.db)
    .await;

    let _ = sqlx::query(
        "UPDATE items SET remaining_supply = GREATEST(0, remaining_supply - 1) WHERE id = $1",
    )
    .bind(item_id)
    .execute(&state.db)
    .await;

    tracing::info!("Relay purchase confirmed: item={} buyer={} tx={}", item_id, wallet, tx_hash);

    HttpResponse::Ok().json(json!({
        "success": true,
        "item_id": item_id,
        "wallet_address": wallet,
        "tx_hash": tx_hash,
    }))
}
