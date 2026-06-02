use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use serde_json::json;

use crate::AppState;

pub async fn get_player(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();

    let result = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(player)) => HttpResponse::Ok().json(player),
        Ok(None) => HttpResponse::NotFound().json(json!({"error": "Player not found"})),
        Err(e) => {
            tracing::error!("DB error: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

pub async fn daily_claim(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();
    let now = Utc::now();
    let cutoff = now - chrono::Duration::hours(24);

    // Check last claim
    let last: Option<(chrono::DateTime<Utc>,)> = sqlx::query_as(
        "SELECT last_claimed_at FROM daily_claims WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    if let Some((last_claimed,)) = last {
        if last_claimed > cutoff {
            return HttpResponse::TooManyRequests().json(json!({
                "error": "Already claimed today",
                "next_claim_at": last_claimed + chrono::Duration::hours(24)
            }));
        }
    }

    // Upsert daily claim record
    let upsert_result = sqlx::query(
        "INSERT INTO daily_claims (wallet_address, last_claimed_at)
         VALUES ($1, $2)
         ON CONFLICT (wallet_address) DO UPDATE SET last_claimed_at = $2",
    )
    .bind(&wallet)
    .bind(now)
    .execute(&state.db)
    .await;

    if upsert_result.is_err() {
        return HttpResponse::InternalServerError().json(json!({"error": "Failed to record claim"}));
    }

    // Update last_active
    let _ = sqlx::query(
        "UPDATE players SET last_active = $1 WHERE wallet_address = $2",
    )
    .bind(now)
    .bind(&wallet)
    .execute(&state.db)
    .await;

    // TODO: Distribute 5 G$ via GoodCollective SDK
    // This will be implemented when GoodCollective pool is configured.

    HttpResponse::Ok().json(json!({
        "success": true,
        "g_claimed": 5,
        "next_claim_at": now + chrono::Duration::hours(24)
    }))
}

pub async fn decay_check(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();
    let now = Utc::now();

    let player_result = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await;

    let player = match player_result {
        Ok(Some(p)) => p,
        Ok(None) => return HttpResponse::NotFound().json(json!({"error": "Player not found"})),
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    // Check if decay is frozen
    if let Some(frozen_until) = player.decay_frozen_until {
        if frozen_until > now {
            return HttpResponse::Ok().json(json!({"decay_status": "none", "frozen": true}));
        }
    }

    let hours_inactive = (now - player.last_active).num_hours();
    let new_status = if hours_inactive >= 72 {
        "active"
    } else if hours_inactive >= 48 {
        "warning"
    } else {
        "none"
    };

    // Penalize if active decay — downgrade rank
    if new_status == "active" && player.decay_status != "active" {
        let _ = sqlx::query(
            "UPDATE players SET decay_status = $1, rank = CASE
                WHEN rank = 'Diamond' THEN 'Platinum'
                WHEN rank = 'Platinum' THEN 'Gold'
                WHEN rank = 'Gold' THEN 'Silver'
                WHEN rank = 'Silver' THEN 'Bronze'
                ELSE rank
             END WHERE wallet_address = $2",
        )
        .bind(new_status)
        .bind(&wallet)
        .execute(&state.db)
        .await;
    } else if new_status != player.decay_status.as_str() {
        let _ = sqlx::query("UPDATE players SET decay_status = $1 WHERE wallet_address = $2")
            .bind(new_status)
            .bind(&wallet)
            .execute(&state.db)
            .await;
    }

    HttpResponse::Ok().json(json!({"decay_status": new_status, "hours_inactive": hours_inactive}))
}
