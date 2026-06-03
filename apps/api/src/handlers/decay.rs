use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use serde_json::json;

use crate::AppState;

// Called by a cron job (Railway cron or external scheduler) every 30 minutes.
// Sweeps all players and applies decay warnings / rank downgrades.
pub async fn run_decay_sweep(state: web::Data<AppState>, req: HttpRequest) -> HttpResponse {
    // Require a shared secret so this endpoint can't be triggered by anyone
    let expected = std::env::var("DECAY_CRON_SECRET").unwrap_or_default();
    let provided = req
        .headers()
        .get("x-cron-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !expected.is_empty() && provided != expected {
        return HttpResponse::Unauthorized().finish();
    }

    let now = Utc::now();
    let warn_threshold = now - chrono::Duration::hours(48);
    let decay_threshold = now - chrono::Duration::hours(72);

    // Set warning status
    let warn_result = sqlx::query(
        "UPDATE players
         SET decay_status = 'warning'
         WHERE last_active < $1
           AND last_active >= $2
           AND (decay_frozen_until IS NULL OR decay_frozen_until < NOW())
           AND decay_status = 'none'",
    )
    .bind(warn_threshold)
    .bind(decay_threshold)
    .execute(&state.db)
    .await;

    // Apply rank downgrade for players at 72+ hours
    let decay_result = sqlx::query(
        "UPDATE players
         SET decay_status = 'active',
             rank = CASE
               WHEN rank = 'Diamond'  THEN 'Platinum'
               WHEN rank = 'Platinum' THEN 'Gold'
               WHEN rank = 'Gold'     THEN 'Silver'
               WHEN rank = 'Silver'   THEN 'Bronze'
               ELSE rank
             END
         WHERE last_active < $1
           AND (decay_frozen_until IS NULL OR decay_frozen_until < NOW())
           AND decay_status != 'active'",
    )
    .bind(decay_threshold)
    .execute(&state.db)
    .await;

    let warned = warn_result.map(|r| r.rows_affected()).unwrap_or(0);
    let decayed = decay_result.map(|r| r.rows_affected()).unwrap_or(0);

    tracing::info!(
        "Decay sweep: {} warned, {} rank-downgraded",
        warned,
        decayed
    );

    HttpResponse::Ok().json(json!({
        "warned": warned,
        "decayed": decayed,
        "ran_at": now.to_rfc3339(),
    }))
}
