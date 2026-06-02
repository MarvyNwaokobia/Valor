use actix_web::{web, HttpResponse};
use serde_json::json;

use crate::AppState;
use crate::models::item::Item;

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
