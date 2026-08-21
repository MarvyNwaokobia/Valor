//! Friends — an opt-in social graph, deliberately separate from `referrals`.
//!
//! A referral is a one-time payout for bringing in a new verified player; it says
//! nothing about who anyone actually wants to stay connected to. So a friendship is
//! never inferred from one — it is always a request the recipient chooses to accept,
//! same as any other social graph.
//!
//! Every relationship is one row in `friendships`, undirected once accepted. The
//! DB's `idx_friendships_unique_pair` index (LEAST/GREATEST-normalised) is what
//! actually prevents two rows describing the same pair — the "already pending /
//! already friends" checks below exist to turn that constraint into a clear error
//! (or, for the mutual-request case, an auto-accept) instead of a raw DB failure.

use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::services::push::notify;
use crate::utils::{display_name, is_valid_wallet, normalize_wallet};
use crate::AppState;

#[derive(sqlx::FromRow)]
struct PersonRow {
    wallet:         String,
    username:       Option<String>,
    character_name: String,
    rank:           String,
}

/// Resolve "who is this" from either a wallet address or a username — the caller
/// chooses which one they're typing, but this is where that choice actually gets
/// looked up. A wallet-shaped string is matched as a wallet; anything else is
/// matched as a username. Never both, so a username that happened to look like a
/// wallet (impossible today — usernames aren't hex — but not worth relying on)
/// can't be ambiguous.
async fn resolve_person(state: &AppState, identifier: &str) -> Option<PersonRow> {
    if is_valid_wallet(identifier) {
        let wallet = normalize_wallet(identifier);
        sqlx::query_as::<_, PersonRow>(
            "SELECT wallet_address AS wallet, username, character_name, rank
             FROM players WHERE wallet_address = $1",
        )
        .bind(&wallet)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None)
    } else {
        sqlx::query_as::<_, PersonRow>(
            "SELECT wallet_address AS wallet, username, character_name, rank
             FROM players WHERE LOWER(username) = LOWER($1) LIMIT 1",
        )
        .bind(identifier)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None)
    }
}

#[derive(sqlx::FromRow)]
struct ExistingFriendship {
    id:               Uuid,
    requester_wallet: String,
    status:           String,
}

async fn find_between(state: &AppState, a: &str, b: &str) -> Option<ExistingFriendship> {
    sqlx::query_as::<_, ExistingFriendship>(
        "SELECT id, requester_wallet, status FROM friendships
         WHERE (requester_wallet = $1 AND recipient_wallet = $2)
            OR (requester_wallet = $2 AND recipient_wallet = $1)",
    )
    .bind(a)
    .bind(b)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None)
}

// ── POST /players/:wallet/friends/request ─────────────────────────────────────
#[derive(Deserialize)]
pub struct RequestBody {
    /// Either a wallet address or a username — resolve_person tells them apart.
    pub identifier: String,
}

pub async fn send_request(
    state: web::Data<AppState>,
    path:  web::Path<String>,
    body:  web::Json<RequestBody>,
) -> HttpResponse {
    let raw_wallet = path.into_inner();
    if !is_valid_wallet(&raw_wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&raw_wallet);

    let target = match resolve_person(&state, body.identifier.trim()).await {
        Some(p) => p,
        None => return HttpResponse::NotFound().json(json!({"error": "No such player"})),
    };
    if target.wallet == wallet {
        return HttpResponse::BadRequest().json(json!({"error": "You can't friend yourself"}));
    }
    let requester_name = display_name(&state.db, &wallet).await.unwrap_or_else(|| "A player".into());

    if let Some(existing) = find_between(&state, &wallet, &target.wallet).await {
        if existing.status == "accepted" {
            return HttpResponse::Conflict().json(json!({"error": "Already friends"}));
        }
        if existing.requester_wallet == wallet {
            return HttpResponse::Conflict().json(json!({"error": "Request already sent"}));
        }
        // They already sent ME a request — accepting it is the honest outcome of
        // "both people want this", rather than making the second person hit a
        // confusing "already pending" error for something that should just work.
        let accepted = sqlx::query(
            "UPDATE friendships SET status = 'accepted', responded_at = now()
             WHERE id = $1",
        )
        .bind(existing.id)
        .execute(&state.db)
        .await;
        return match accepted {
            Ok(_) => {
                // `target` was the original requester — they're the one who should
                // hear that their pending request just got a yes.
                notify(&state, target.wallet.clone(), format!("{requester_name} accepted your friend request"), "/friends");
                HttpResponse::Ok().json(json!({"status": "accepted", "auto_accepted": true}))
            }
            Err(e) => {
                tracing::error!("friend auto-accept failed: {}", e);
                HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
            }
        };
    }

    let id = Uuid::new_v4();
    let inserted = sqlx::query(
        "INSERT INTO friendships (id, requester_wallet, recipient_wallet, status)
         VALUES ($1, $2, $3, 'pending')",
    )
    .bind(id)
    .bind(&wallet)
    .bind(&target.wallet)
    .execute(&state.db)
    .await;

    match inserted {
        Ok(_) => {
            notify(&state, target.wallet.clone(), format!("{requester_name} sent you a friend request"), "/friends");
            HttpResponse::Ok().json(json!({"status": "pending", "to": target.wallet}))
        }
        Err(e) => {
            tracing::error!("friend request insert failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── POST /players/:wallet/friends/:other/accept ───────────────────────────────
pub async fn accept_request(
    state: web::Data<AppState>,
    path:  web::Path<(String, String)>,
) -> HttpResponse {
    let (raw_wallet, raw_other) = path.into_inner();
    if !is_valid_wallet(&raw_wallet) || !is_valid_wallet(&raw_other) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&raw_wallet);
    let other  = normalize_wallet(&raw_other);

    // Direction matters here (unlike remove_friend below): only the RECIPIENT of
    // a pending request can accept it — the sender accepting their own request
    // would let anyone friend anyone unilaterally.
    let updated = sqlx::query(
        "UPDATE friendships SET status = 'accepted', responded_at = now()
         WHERE requester_wallet = $1 AND recipient_wallet = $2 AND status = 'pending'",
    )
    .bind(&other)
    .bind(&wallet)
    .execute(&state.db)
    .await;

    match updated {
        Ok(r) if r.rows_affected() > 0 => {
            let accepter_name = display_name(&state.db, &wallet).await.unwrap_or_else(|| "A player".into());
            notify(&state, other.clone(), format!("{accepter_name} accepted your friend request"), "/friends");
            HttpResponse::Ok().json(json!({"status": "accepted"}))
        }
        Ok(_) => HttpResponse::NotFound().json(json!({"error": "No pending request from that player"})),
        Err(e) => {
            tracing::error!("friend accept failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── DELETE /players/:wallet/friends/:other ─────────────────────────────────────
// Covers three cases with one query: the recipient declining a pending request,
// either side cancelling their own outgoing request, and either side unfriending
// an accepted one. All three are "this relationship should no longer exist" —
// there is no state a delete here can leave stranded, so one handler is enough.
pub async fn remove_friend(
    state: web::Data<AppState>,
    path:  web::Path<(String, String)>,
) -> HttpResponse {
    let (raw_wallet, raw_other) = path.into_inner();
    if !is_valid_wallet(&raw_wallet) || !is_valid_wallet(&raw_other) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&raw_wallet);
    let other  = normalize_wallet(&raw_other);

    let deleted = sqlx::query(
        "DELETE FROM friendships
         WHERE (requester_wallet = $1 AND recipient_wallet = $2)
            OR (requester_wallet = $2 AND recipient_wallet = $1)",
    )
    .bind(&wallet)
    .bind(&other)
    .execute(&state.db)
    .await;

    match deleted {
        Ok(_) => HttpResponse::Ok().json(json!({"removed": true})),
        Err(e) => {
            tracing::error!("friend remove failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /players/:wallet/friends ────────────────────────────────────────────────
pub async fn list_friends(
    state: web::Data<AppState>,
    path:  web::Path<String>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    let rows: Vec<PersonRow> = sqlx::query_as(
        "SELECT p.wallet_address AS wallet, p.username, p.character_name, p.rank
         FROM friendships f
         JOIN players p ON p.wallet_address =
             CASE WHEN f.requester_wallet = $1 THEN f.recipient_wallet ELSE f.requester_wallet END
         WHERE (f.requester_wallet = $1 OR f.recipient_wallet = $1) AND f.status = 'accepted'
         ORDER BY COALESCE(NULLIF(p.username, ''), p.character_name)",
    )
    .bind(&wallet)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let friends: Vec<_> = rows.into_iter().map(|p| json!({
        "wallet": p.wallet, "username": p.username,
        "character_name": p.character_name, "rank": p.rank,
    })).collect();

    HttpResponse::Ok().json(json!({ "friends": friends }))
}

// ── GET /players/:wallet/friends/requests ───────────────────────────────────────
#[derive(sqlx::FromRow)]
struct RequestRow {
    wallet:         String,
    username:       Option<String>,
    character_name: String,
    rank:           String,
    created_at:     chrono::DateTime<chrono::Utc>,
}

pub async fn list_requests(
    state: web::Data<AppState>,
    path:  web::Path<String>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    let incoming: Vec<RequestRow> = sqlx::query_as(
        "SELECT p.wallet_address AS wallet, p.username, p.character_name, p.rank, f.created_at
         FROM friendships f JOIN players p ON p.wallet_address = f.requester_wallet
         WHERE f.recipient_wallet = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC",
    )
    .bind(&wallet)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let outgoing: Vec<RequestRow> = sqlx::query_as(
        "SELECT p.wallet_address AS wallet, p.username, p.character_name, p.rank, f.created_at
         FROM friendships f JOIN players p ON p.wallet_address = f.recipient_wallet
         WHERE f.requester_wallet = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC",
    )
    .bind(&wallet)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let to_json = |rows: Vec<RequestRow>| -> Vec<serde_json::Value> {
        rows.into_iter().map(|p| json!({
            "wallet": p.wallet, "username": p.username,
            "character_name": p.character_name, "rank": p.rank, "created_at": p.created_at,
        })).collect()
    };

    HttpResponse::Ok().json(json!({
        "incoming": to_json(incoming),
        "outgoing": to_json(outgoing),
    }))
}
