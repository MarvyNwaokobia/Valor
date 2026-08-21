//! Friend chat — 1:1 messages, gated to accepted friendships. Sending goes
//! through REST rather than the `/ws/chat` socket (see chat_ws.rs) so a DB
//! write, the friendship check, the push notification, and the socket fan-out
//! all live in one place regardless of which transport the reader is on.

use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::handlers::friends::find_between;
use crate::services::chat_hub;
use crate::services::push::notify;
use crate::utils::{display_name, is_valid_wallet, normalize_wallet};
use crate::AppState;

const MAX_BODY_LEN: usize = 2000;
const PUSH_PREVIEW_LEN: usize = 120;

#[derive(sqlx::FromRow, serde::Serialize)]
struct MessageRow {
    id:               Uuid,
    sender_wallet:    String,
    recipient_wallet: String,
    body:             String,
    created_at:       chrono::DateTime<chrono::Utc>,
    read_at:          Option<chrono::DateTime<chrono::Utc>>,
}

// ── POST /players/:wallet/friends/:other/messages ───────────────────────────────
#[derive(Deserialize)]
pub struct SendBody {
    pub body: String,
}

pub async fn send_message(
    state: web::Data<AppState>,
    path:  web::Path<(String, String)>,
    body:  web::Json<SendBody>,
) -> HttpResponse {
    let (raw_wallet, raw_other) = path.into_inner();
    if !is_valid_wallet(&raw_wallet) || !is_valid_wallet(&raw_other) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&raw_wallet);
    let other  = normalize_wallet(&raw_other);

    let text = body.body.trim();
    if text.is_empty() {
        return HttpResponse::BadRequest().json(json!({"error": "Message can't be empty"}));
    }
    if text.chars().count() > MAX_BODY_LEN {
        return HttpResponse::BadRequest().json(json!({"error": "Message is too long"}));
    }

    match find_between(&state, &wallet, &other).await {
        Some(f) if f.status == "accepted" => {}
        _ => return HttpResponse::Forbidden().json(json!({"error": "You can only message friends"})),
    }

    if !state.chat_limiter.check(&wallet) {
        return HttpResponse::TooManyRequests().json(json!({"error": "Slow down a little"}));
    }

    let id = Uuid::new_v4();
    let inserted: Result<MessageRow, _> = sqlx::query_as(
        "INSERT INTO chat_messages (id, sender_wallet, recipient_wallet, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, sender_wallet, recipient_wallet, body, created_at, read_at",
    )
    .bind(id)
    .bind(&wallet)
    .bind(&other)
    .bind(text)
    .fetch_one(&state.db)
    .await;

    match inserted {
        Ok(row) => {
            let sender_name = display_name(&state.db, &wallet).await.unwrap_or_else(|| "A friend".into());
            let preview: String = text.chars().take(PUSH_PREVIEW_LEN).collect();
            notify(&state, other.clone(), format!("{sender_name}: {preview}"), "/friends");

            let payload = json!({
                "type": "new_message",
                "id": row.id,
                "from": row.sender_wallet,
                "to": row.recipient_wallet,
                "body": row.body,
                "created_at": row.created_at,
            });
            if let Ok(text) = serde_json::to_string(&payload) {
                chat_hub::send_to(&state.chat_hub, &other, text);
            }

            HttpResponse::Ok().json(row)
        }
        Err(e) => {
            tracing::error!("chat send failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /players/:wallet/friends/:other/messages ─────────────────────────────────
#[derive(Deserialize)]
pub struct ListQuery {
    pub before: Option<chrono::DateTime<chrono::Utc>>,
    pub limit:  Option<i64>,
}

pub async fn list_messages(
    state: web::Data<AppState>,
    path:  web::Path<(String, String)>,
    query: web::Query<ListQuery>,
) -> HttpResponse {
    let (raw_wallet, raw_other) = path.into_inner();
    if !is_valid_wallet(&raw_wallet) || !is_valid_wallet(&raw_other) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&raw_wallet);
    let other  = normalize_wallet(&raw_other);
    let limit  = query.limit.unwrap_or(50).clamp(1, 100);

    let rows: Vec<MessageRow> = sqlx::query_as(
        "SELECT id, sender_wallet, recipient_wallet, body, created_at, read_at
         FROM chat_messages
         WHERE ((sender_wallet = $1 AND recipient_wallet = $2)
             OR (sender_wallet = $2 AND recipient_wallet = $1))
           AND ($3::timestamptz IS NULL OR created_at < $3)
         ORDER BY created_at DESC
         LIMIT $4",
    )
    .bind(&wallet)
    .bind(&other)
    .bind(query.before)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    HttpResponse::Ok().json(json!({ "messages": rows }))
}

// ── POST /players/:wallet/friends/:other/messages/read ──────────────────────────
pub async fn mark_read(
    state: web::Data<AppState>,
    path:  web::Path<(String, String)>,
) -> HttpResponse {
    let (raw_wallet, raw_other) = path.into_inner();
    if !is_valid_wallet(&raw_wallet) || !is_valid_wallet(&raw_other) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&raw_wallet);
    let other  = normalize_wallet(&raw_other);

    let updated = sqlx::query(
        "UPDATE chat_messages SET read_at = now()
         WHERE recipient_wallet = $1 AND sender_wallet = $2 AND read_at IS NULL",
    )
    .bind(&wallet)
    .bind(&other)
    .execute(&state.db)
    .await;

    match updated {
        Ok(_) => HttpResponse::Ok().json(json!({"read": true})),
        Err(e) => {
            tracing::error!("chat mark_read failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /players/:wallet/messages/unread-counts ──────────────────────────────────
#[derive(sqlx::FromRow)]
struct UnreadRow {
    sender_wallet: String,
    count:         i64,
}

pub async fn unread_counts(
    state: web::Data<AppState>,
    path:  web::Path<String>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    let rows: Vec<UnreadRow> = sqlx::query_as(
        "SELECT sender_wallet, COUNT(*) AS count FROM chat_messages
         WHERE recipient_wallet = $1 AND read_at IS NULL
         GROUP BY sender_wallet",
    )
    .bind(&wallet)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let counts: serde_json::Map<String, serde_json::Value> = rows
        .into_iter()
        .map(|r| (r.sender_wallet, json!(r.count)))
        .collect();

    HttpResponse::Ok().json(json!({ "counts": counts }))
}
