//! Player groups: communities (a university, a gaming crowd) with their own join link
//! and their own slice of the season board.
//!
//! Membership is permanent identity (see add_player_groups.sql). A group board is the
//! ordinary season board filtered to a group's members, so there is no second scoring
//! system to drift from the real one: the score is `endless_progress.wave - 1`, ranked
//! by waves completed with ties broken by who reached the wave first, exactly as in
//! `seasons::season_board`.

use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::handlers::admin::verify_admin_token;
use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::AppState;

#[derive(FromRow)]
struct GroupRow {
    id: Uuid,
    slug: String,
    name: String,
    description: String,
}

fn valid_slug(s: &str) -> bool {
    (2..=40).contains(&s.len())
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

async fn find_group(db: &sqlx::PgPool, slug: &str) -> Option<GroupRow> {
    sqlx::query_as::<_, GroupRow>(
        "SELECT id, slug, name, description FROM player_groups
         WHERE LOWER(slug) = LOWER($1) AND active",
    )
    .bind(slug)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
}

async fn member_count(db: &sqlx::PgPool, group_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM group_members WHERE group_id = $1")
        .bind(group_id)
        .fetch_one(db)
        .await
        .unwrap_or(0)
}

// ── GET /groups/:slug ──────────────────────────────────────────────────────────
// Public: what the join page shows before anyone signs in.
pub async fn get_group(state: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let Some(g) = find_group(&state.db, &path.into_inner()).await else {
        return HttpResponse::NotFound().json(json!({"error": "Group not found"}));
    };
    let members = member_count(&state.db, g.id).await;
    HttpResponse::Ok().json(json!({
        "slug": g.slug, "name": g.name, "description": g.description, "members": members,
    }))
}

// ── GET /players/:wallet/group ─────────────────────────────────────────────────
pub async fn get_my_group(state: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());
    let row: Option<GroupRow> = sqlx::query_as(
        "SELECT g.id, g.slug, g.name, g.description
         FROM group_members m JOIN player_groups g ON g.id = m.group_id
         WHERE m.wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    match row {
        Some(g) => HttpResponse::Ok().json(json!({"group": {"slug": g.slug, "name": g.name}})),
        None => HttpResponse::Ok().json(json!({"group": null})),
    }
}

#[derive(Deserialize)]
pub struct JoinRequest {
    pub slug: String,
}

// ── POST /players/:wallet/group ────────────────────────────────────────────────
// Player-authed. Joining the group you are already in succeeds (so a re-click or a
// retry is harmless). Switching groups requires leaving first: a prize board is only
// honest if a player cannot hop to whichever group is winning.
pub async fn join(
    req: HttpRequest,
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<JoinRequest>,
) -> HttpResponse {
    let raw = path.into_inner();
    if !is_valid_wallet(&raw) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&raw);
    if let Err(resp) = crate::auth::verify_player_token(&req, &wallet) { return resp; }

    let Some(g) = find_group(&state.db, &body.slug).await else {
        return HttpResponse::NotFound().json(json!({"error": "Group not found"}));
    };

    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT group_id FROM group_members WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match existing {
        Some(id) if id == g.id => {
            return HttpResponse::Ok().json(json!({"ok": true, "group": {"slug": g.slug, "name": g.name}}));
        }
        Some(_) => {
            return HttpResponse::Conflict()
                .json(json!({"error": "You are already in a group. Leave it first to join another."}));
        }
        None => {}
    }

    match sqlx::query(
        "INSERT INTO group_members (wallet_address, group_id) VALUES ($1, $2)
         ON CONFLICT (wallet_address) DO NOTHING",
    )
    .bind(&wallet)
    .bind(g.id)
    .execute(&state.db)
    .await
    {
        Ok(_) => HttpResponse::Ok().json(json!({"ok": true, "group": {"slug": g.slug, "name": g.name}})),
        Err(e) => {
            tracing::error!("group join failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── DELETE /players/:wallet/group ──────────────────────────────────────────────
pub async fn leave(req: HttpRequest, state: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());
    if let Err(resp) = crate::auth::verify_player_token(&req, &wallet) { return resp; }
    match sqlx::query("DELETE FROM group_members WHERE wallet_address = $1")
        .bind(&wallet)
        .execute(&state.db)
        .await
    {
        Ok(_) => HttpResponse::Ok().json(json!({"ok": true})),
        Err(e) => {
            tracing::error!("group leave failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

#[derive(Deserialize)]
pub struct BoardQuery {
    pub season_id: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(FromRow)]
struct BoardRow {
    wallet_address: String,
    username: Option<String>,
    waves: i32,
    joined_at: chrono::DateTime<chrono::Utc>,
}

async fn group_board(db: &sqlx::PgPool, g: &GroupRow, q: &BoardQuery) -> serde_json::Value {
    // Default to the same season the public Season board shows: live now, else latest.
    let season: Option<(Uuid, String)> = match q.season_id {
        Some(id) => sqlx::query_as("SELECT id, name FROM seasons WHERE id = $1")
            .bind(id).fetch_optional(db).await.ok().flatten(),
        None => sqlx::query_as(
            "SELECT id, name FROM seasons
             ORDER BY (starts_at <= now() AND (ends_at IS NULL OR ends_at >= now())) DESC,
                      starts_at DESC
             LIMIT 1",
        ).fetch_optional(db).await.ok().flatten(),
    };
    let Some((season_id, season_name)) = season else {
        return json!({"group": {"slug": g.slug, "name": g.name}, "season": null, "entries": []});
    };

    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let rows: Vec<BoardRow> = sqlx::query_as(
        "SELECT e.wallet_address, p.username, (e.wave - 1) AS waves, m.joined_at
         FROM endless_progress e
         JOIN group_members m ON m.wallet_address = e.wallet_address AND m.group_id = $2
         LEFT JOIN players p ON p.wallet_address = e.wallet_address
         WHERE e.season_id = $1 AND e.wave > 1
         ORDER BY e.wave DESC, e.reached_at ASC
         LIMIT $3",
    )
    .bind(season_id).bind(g.id).bind(limit)
    .fetch_all(db).await.unwrap_or_default();

    let entries: Vec<_> = rows.iter().enumerate().map(|(i, r)| json!({
        "rank": i + 1,
        "wallet_address": r.wallet_address,
        "username": r.username,
        "waves": r.waves,
        "joined_at": r.joined_at.to_rfc3339(),
    })).collect();

    json!({
        "group": {"slug": g.slug, "name": g.name},
        "season": {"id": season_id, "name": season_name},
        "entries": entries,
    })
}

// ── GET /groups/:slug/board ────────────────────────────────────────────────────
pub async fn board(state: web::Data<AppState>, path: web::Path<String>, q: web::Query<BoardQuery>) -> HttpResponse {
    let Some(g) = find_group(&state.db, &path.into_inner()).await else {
        return HttpResponse::NotFound().json(json!({"error": "Group not found"}));
    };
    HttpResponse::Ok().json(group_board(&state.db, &g, &q).await)
}

// ── Admin ──────────────────────────────────────────────────────────────────────

// GET /admin/groups
pub async fn admin_list(req: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) { return resp; }
    let rows: Vec<(Uuid, String, String, bool, i64)> = sqlx::query_as(
        "SELECT g.id, g.slug, g.name, g.active, COUNT(m.wallet_address)
         FROM player_groups g LEFT JOIN group_members m ON m.group_id = g.id
         GROUP BY g.id ORDER BY g.created_at",
    )
    .fetch_all(&state.db).await.unwrap_or_default();
    let groups: Vec<_> = rows.iter().map(|(id, slug, name, active, n)| json!({
        "id": id, "slug": slug, "name": name, "active": active, "members": n,
    })).collect();
    HttpResponse::Ok().json(json!({"groups": groups}))
}

#[derive(Deserialize)]
pub struct CreateGroup {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
}

// POST /admin/groups: a new community = a row, no redeploy.
pub async fn admin_create(req: HttpRequest, state: web::Data<AppState>, body: web::Json<CreateGroup>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) { return resp; }
    let slug = body.slug.trim().to_lowercase();
    let name = body.name.trim();
    if !valid_slug(&slug) {
        return HttpResponse::BadRequest()
            .json(json!({"error": "Slug must be 2-40 chars: lowercase letters, digits, dashes"}));
    }
    if name.is_empty() || name.len() > 60 {
        return HttpResponse::BadRequest().json(json!({"error": "Name must be 1-60 characters"}));
    }
    match sqlx::query("INSERT INTO player_groups (slug, name, description) VALUES ($1, $2, $3)")
        .bind(&slug).bind(name).bind(body.description.trim())
        .execute(&state.db).await
    {
        Ok(_) => HttpResponse::Ok().json(json!({"ok": true, "slug": slug})),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            HttpResponse::Conflict().json(json!({"error": "That slug is taken"}))
        }
        Err(e) => {
            tracing::error!("group create failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}
