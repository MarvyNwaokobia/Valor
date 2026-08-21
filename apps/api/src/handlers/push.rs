use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use crate::services::push::PushPayload;
use crate::utils::normalize_wallet;
use crate::AppState;

/// How long a wallet is left alone after a reminder before it's eligible again.
/// One tick short of 24h so a cron that fires a little early each day doesn't
/// skip a wallet.
const RENOTIFY_AFTER_HOURS: i64 = 20;
/// Idle time before a wallet is considered "hasn't played today" and worth a nudge.
const IDLE_AFTER_HOURS: i64 = 22;

// ── GET /push/vapid-public-key ──────────────────────────────────────────────
pub async fn vapid_public_key(state: web::Data<AppState>) -> HttpResponse {
    match &state.push {
        Some(push) => HttpResponse::Ok().json(json!({ "key": push.public_key_base64() })),
        None => HttpResponse::ServiceUnavailable().json(json!({"error": "push not configured"})),
    }
}

#[derive(Deserialize)]
pub struct SubscribeKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Deserialize)]
pub struct SubscribeRequest {
    pub endpoint: String,
    pub keys: SubscribeKeys,
}

// ── POST /players/{wallet}/push-subscription ────────────────────────────────
// Idempotent by design (ON CONFLICT on the unique endpoint) — the frontend calls
// this on every app open to keep last_notified_at fresh-adjacent metadata correct,
// not just on the first opt-in.
pub async fn subscribe(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<SubscribeRequest>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    let result = sqlx::query(
        "INSERT INTO push_subscriptions (wallet_address, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE
           SET wallet_address = EXCLUDED.wallet_address,
               p256dh         = EXCLUDED.p256dh,
               auth           = EXCLUDED.auth",
    )
    .bind(&wallet)
    .bind(&body.endpoint)
    .bind(&body.keys.p256dh)
    .bind(&body.keys.auth)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => HttpResponse::Ok().json(json!({"ok": true})),
        Err(e) => {
            tracing::warn!("push subscribe failed for {}: {}", wallet, e);
            HttpResponse::InternalServerError().json(json!({"error": "subscribe failed"}))
        }
    }
}

#[derive(Deserialize)]
pub struct UnsubscribeRequest {
    pub endpoint: String,
}

// ── DELETE /players/{wallet}/push-subscription ──────────────────────────────
pub async fn unsubscribe(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<UnsubscribeRequest>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());
    let _ = sqlx::query("DELETE FROM push_subscriptions WHERE wallet_address = $1 AND endpoint = $2")
        .bind(&wallet)
        .bind(&body.endpoint)
        .execute(&state.db)
        .await;
    HttpResponse::Ok().json(json!({"ok": true}))
}

#[derive(sqlx::FromRow)]
struct DueSubscription {
    id: uuid::Uuid,
    endpoint: String,
    p256dh: String,
    auth: String,
}

/// Cron-triggered daily reminder sweep, same shared-secret gate as `/decay/run`
/// (apps/api/src/handlers/decay.rs). Picks subscriptions belonging to a wallet
/// that's gone quiet (idle past IDLE_AFTER_HOURS) and hasn't been notified
/// today, and pushes a single "come back" nudge to each. A dead endpoint
/// (410/404 from the push service) is deleted on the spot so the sweep never
/// pays for it again.
pub async fn run_daily_sweep(state: web::Data<AppState>, req: HttpRequest) -> HttpResponse {
    let expected = std::env::var("DECAY_CRON_SECRET").unwrap_or_default();
    let provided = req
        .headers()
        .get("x-cron-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if expected.is_empty() || provided != expected {
        return HttpResponse::Unauthorized().finish();
    }

    let Some(push) = &state.push else {
        return HttpResponse::Ok().json(json!({"sent": 0, "note": "push not configured"}));
    };

    let now = chrono::Utc::now();
    let idle_threshold = now - chrono::Duration::hours(IDLE_AFTER_HOURS);
    let renotify_threshold = now - chrono::Duration::hours(RENOTIFY_AFTER_HOURS);

    let due: Vec<DueSubscription> = match sqlx::query_as(
        "SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
         FROM push_subscriptions ps
         JOIN players p ON p.wallet_address = ps.wallet_address
         WHERE p.last_active < $1
           AND (ps.last_notified_at IS NULL OR ps.last_notified_at < $2)",
    )
    .bind(idle_threshold)
    .bind(renotify_threshold)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("daily notify sweep: query failed: {}", e);
            return HttpResponse::InternalServerError().json(json!({"error": "query failed"}));
        }
    };

    let payload = PushPayload {
        title: "Valor",
        body: "Your rank is waiting. Jump back in before it starts to slip.",
        url: "/hub",
    };

    let mut sent = 0u32;
    let mut expired = 0u32;
    let mut failed = 0u32;

    for sub in &due {
        match push.send(&sub.endpoint, &sub.p256dh, &sub.auth, &payload).await {
            Ok(outcome) if outcome.expired => {
                expired += 1;
                let _ = sqlx::query("DELETE FROM push_subscriptions WHERE id = $1")
                    .bind(sub.id)
                    .execute(&state.db)
                    .await;
            }
            Ok(_) => {
                sent += 1;
                let _ = sqlx::query(
                    "UPDATE push_subscriptions SET last_notified_at = NOW() WHERE id = $1",
                )
                .bind(sub.id)
                .execute(&state.db)
                .await;
            }
            Err(e) => {
                failed += 1;
                tracing::warn!("daily notify: send failed for subscription {}: {}", sub.id, e);
            }
        }
    }

    tracing::info!(
        "Daily notify sweep: {} sent, {} expired/removed, {} failed",
        sent,
        expired,
        failed
    );

    HttpResponse::Ok().json(json!({
        "sent": sent,
        "expired": expired,
        "failed": failed,
    }))
}
