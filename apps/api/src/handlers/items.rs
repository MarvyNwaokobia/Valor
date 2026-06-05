use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::AppState;
use crate::models::item::Item;
use crate::utils::normalize_wallet;

pub async fn list_items(state: web::Data<AppState>) -> HttpResponse {
    let result = sqlx::query_as::<_, Item>(
        "SELECT * FROM items ORDER BY price_g ASC",
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
// Called after the on-chain ERC-1155 purchase has been confirmed.
// Records the item in the buyer's inventory and decrements remaining_supply.
#[derive(Deserialize)]
pub struct PurchaseRequest {
    pub wallet_address: String,
    pub tx_hash: Option<String>,
}

pub async fn purchase_item(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
    body: web::Json<PurchaseRequest>,
) -> HttpResponse {
    let item_id = path.into_inner();
    let wallet  = normalize_wallet(&body.wallet_address);

    // Verify item exists and has supply
    let item = sqlx::query_as::<_, Item>(
        "SELECT * FROM items WHERE id = $1",
    )
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

    // Add to inventory (idempotent — on-chain events may fire twice)
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

    // Decrement remaining supply (best-effort — not a hard gate since chain is authoritative)
    let _ = sqlx::query(
        "UPDATE items SET remaining_supply = GREATEST(0, remaining_supply - 1) WHERE id = $1",
    )
    .bind(item_id)
    .execute(&state.db)
    .await;

    tracing::info!("Item purchased: {} by {} tx={:?}", item_id, wallet, body.tx_hash);

    HttpResponse::Ok().json(json!({
        "success": true,
        "item_id": item_id,
        "wallet_address": wallet,
    }))
}
