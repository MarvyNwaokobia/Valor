use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{Datelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;

use crate::AppState;

/// Current ISO year-week, e.g. "2026-W26" — the seasonal partition key.
fn current_week_key() -> String {
    let iso = Utc::now().iso_week();
    format!("{}-W{:02}", iso.year(), iso.week())
}

fn is_valid_wallet(w: &str) -> bool {
    w.len() == 42 && w.starts_with("0x") && w[2..].chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Deserialize)]
pub struct SubmitScoreRequest {
    pub wallet: String,
    pub score: i32,
}

/// Record a finished Endless run (waves survived). Rate-limited; the score is the
/// client's reported wave count — low-stakes (it only affects the leaderboard, not
/// G$), so it follows the same "client reports, server guards" model as PvE fights.
pub async fn submit_score(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<SubmitScoreRequest>,
) -> HttpResponse {
    let ip = req.connection_info().realip_remote_addr().unwrap_or("unknown").to_string();
    if !state.battle_limiter.check(&ip) {
        return HttpResponse::TooManyRequests().json(json!({"error": "Too many submissions. Slow down."}));
    }
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    if body.score < 0 || body.score > 10_000 {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid score"}));
    }

    let wallet = body.wallet.to_lowercase();
    let week = current_week_key();

    let res = sqlx::query(
        "INSERT INTO endless_scores (wallet_address, score, week_key, created_at)
         VALUES ($1, $2, $3, now())",
    )
    .bind(&wallet)
    .bind(body.score)
    .bind(&week)
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => HttpResponse::Ok().json(json!({"ok": true, "week": week})),
        Err(e) => {
            tracing::error!("endless score insert failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Failed to record score"}))
        }
    }
}

#[derive(Serialize, FromRow)]
pub struct LeaderRow {
    pub wallet_address: String,
    pub username: Option<String>,
    pub best: i32,
}

#[derive(Deserialize)]
pub struct LeaderQuery {
    pub scope: Option<String>, // "weekly" → current ISO week; anything else → all-time
    pub limit: Option<i64>,
}

/// Top Endless scores. `?scope=weekly` restricts to the current ISO week (the
/// seasonal/tournament board); otherwise it's all-time. Best score per wallet.
pub async fn get_leaderboard(
    state: web::Data<AppState>,
    query: web::Query<LeaderQuery>,
) -> HttpResponse {
    let weekly = query.scope.as_deref() == Some("weekly");
    let limit = query.limit.unwrap_or(25).clamp(1, 100);

    let rows = if weekly {
        sqlx::query_as::<_, LeaderRow>(
            "SELECT e.wallet_address, p.username, COALESCE(MAX(e.score), 0) AS best
             FROM endless_scores e
             LEFT JOIN players p ON p.wallet_address = e.wallet_address
             WHERE e.week_key = $1
             GROUP BY e.wallet_address, p.username
             ORDER BY best DESC
             LIMIT $2",
        )
        .bind(current_week_key())
        .bind(limit)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, LeaderRow>(
            "SELECT e.wallet_address, p.username, COALESCE(MAX(e.score), 0) AS best
             FROM endless_scores e
             LEFT JOIN players p ON p.wallet_address = e.wallet_address
             GROUP BY e.wallet_address, p.username
             ORDER BY best DESC
             LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await
    };

    match rows {
        Ok(r) => HttpResponse::Ok().json(json!({ "scope": if weekly { "weekly" } else { "all" }, "entries": r })),
        Err(e) => {
            tracing::error!("endless leaderboard query failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Failed to load leaderboard"}))
        }
    }
}
