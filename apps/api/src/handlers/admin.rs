use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use ethers::types::{Address, Signature};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::AppState;

/// Admin session claims — deliberately a distinct JWT (separate secret,
/// `role: "admin"`) from the player Supabase-RLS tokens `auth.rs` issues, so
/// the two can never be confused for one another.
#[derive(Serialize, Deserialize)]
struct AdminClaims {
    sub: String,
    role: String,
    exp: u64,
    iat: u64,
}

fn admin_allowlist() -> Vec<String> {
    std::env::var("ADMIN_WALLETS")
        .unwrap_or_default()
        .split(',')
        .map(|s| normalize_wallet(s.trim()))
        .filter(|s| !s.is_empty())
        .collect()
}

fn verify_admin_token(req: &HttpRequest) -> Result<String, HttpResponse> {
    let jwt_secret = std::env::var("ADMIN_JWT_SECRET").map_err(|_| {
        HttpResponse::ServiceUnavailable().json(json!({"error": "Admin auth not configured"}))
    })?;

    let token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| HttpResponse::Unauthorized().json(json!({"error": "Missing or malformed Authorization header"})))?;

    let data = decode::<AdminClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| HttpResponse::Unauthorized().json(json!({"error": "Invalid or expired admin session"})))?;

    if data.claims.role != "admin" {
        return Err(HttpResponse::Unauthorized().json(json!({"error": "Not an admin session"})));
    }
    Ok(data.claims.sub)
}

// ── POST /admin/login ──────────────────────────────────────────────────────────
// Verifies a wallet signature over a message embedding a fresh timestamp
// (prevents replaying an old signature), checks the wallet is in the
// ADMIN_WALLETS allowlist, and issues a short-lived admin JWT.
#[derive(Deserialize)]
pub struct AdminLoginRequest {
    pub wallet: String,
    pub message: String,
    pub signature: String,
}

pub async fn login(body: web::Json<AdminLoginRequest>) -> HttpResponse {
    let jwt_secret = match std::env::var("ADMIN_JWT_SECRET") {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::ServiceUnavailable()
                .json(json!({"error": "Admin auth not configured (ADMIN_JWT_SECRET missing)"}))
        }
    };

    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet_norm = normalize_wallet(&body.wallet);
    if !admin_allowlist().contains(&wallet_norm) {
        return HttpResponse::Unauthorized().json(json!({"error": "Not an admin wallet"}));
    }
    if body.signature.len() < 130 {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid signature"}));
    }
    if body.message.len() > 256 {
        return HttpResponse::BadRequest().json(json!({"error": "Message too long"}));
    }

    let Some(ts) = body
        .message
        .lines()
        .find_map(|l| l.strip_prefix("timestamp:"))
        .and_then(|s| s.trim().parse::<i64>().ok())
    else {
        return HttpResponse::BadRequest().json(json!({"error": "Malformed login message"}));
    };
    if (Utc::now().timestamp() - ts).abs() > 300 {
        return HttpResponse::Unauthorized().json(json!({"error": "Login message expired — try again"}));
    }

    let wallet_addr: Address = match body.wallet.parse() {
        Ok(a) => a,
        Err(_) => return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"})),
    };
    let sig: Signature = match body.signature.parse() {
        Ok(s) => s,
        Err(_) => return HttpResponse::BadRequest().json(json!({"error": "Malformed signature"})),
    };
    if sig.verify(body.message.as_bytes(), wallet_addr).is_err() {
        return HttpResponse::Unauthorized().json(json!({"error": "Signature does not match wallet"}));
    }

    let now = Utc::now().timestamp() as u64;
    let expires_in: u64 = 60 * 60; // 1 hour
    let claims = AdminClaims { sub: wallet_norm.clone(), role: "admin".into(), exp: now + expires_in, iat: now };

    let token = match encode(&Header::default(), &claims, &EncodingKey::from_secret(jwt_secret.as_bytes())) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Admin JWT encode failed: {}", e);
            return HttpResponse::InternalServerError().json(json!({"error": "Failed to issue token"}));
        }
    };

    HttpResponse::Ok().json(json!({ "token": token, "wallet": wallet_norm, "expires_at": now + expires_in }))
}

// ── GET /admin/stats?season_id= ────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct StatsQuery {
    pub season_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct AdminStats {
    pub season_name: Option<String>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub new_players: i64,
    pub active_players: i64,
    pub total_battles: i64,
    #[serde(with = "rust_decimal::serde::float")]
    pub total_g_awarded: Decimal,
    #[serde(with = "rust_decimal::serde::float")]
    pub total_g_volume: Decimal,
}

pub async fn get_stats(
    req: HttpRequest,
    state: web::Data<AppState>,
    query: web::Query<StatsQuery>,
) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) {
        return resp;
    }

    let (season_name, starts_at, ends_at): (Option<String>, DateTime<Utc>, Option<DateTime<Utc>>) =
        if let Some(id) = query.season_id {
            let row: Option<(String, DateTime<Utc>, Option<DateTime<Utc>>)> = sqlx::query_as(
                "SELECT name, starts_at, ends_at FROM seasons WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

            match row {
                Some((name, s, e)) => (Some(name), s, e),
                None => return HttpResponse::NotFound().json(json!({"error": "Season not found"})),
            }
        } else {
            (None, DateTime::<Utc>::from_timestamp(0, 0).unwrap(), None)
        };

    let window_end = ends_at.unwrap_or_else(Utc::now);

    let new_players: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM players WHERE created_at >= $1 AND created_at < $2",
    )
    .bind(starts_at).bind(window_end)
    .fetch_one(&state.db).await.unwrap_or((0,));

    let active_players: (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT wallet) FROM (
            SELECT challenger_wallet AS wallet FROM battles WHERE created_at >= $1 AND created_at < $2
            UNION
            SELECT opponent_wallet AS wallet FROM battles WHERE created_at >= $1 AND created_at < $2
            UNION
            SELECT wallet_address AS wallet FROM g_ledger WHERE created_at >= $1 AND created_at < $2
        ) t",
    )
    .bind(starts_at).bind(window_end)
    .fetch_one(&state.db).await.unwrap_or((0,));

    let total_battles: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM battles WHERE created_at >= $1 AND created_at < $2",
    )
    .bind(starts_at).bind(window_end)
    .fetch_one(&state.db).await.unwrap_or((0,));

    let total_g_awarded: (Decimal,) = sqlx::query_as(
        "SELECT COALESCE(SUM(amount), 0) FROM g_ledger
         WHERE category IN ('ubi_claim', 'battle_reward') AND created_at >= $1 AND created_at < $2",
    )
    .bind(starts_at).bind(window_end)
    .fetch_one(&state.db).await.unwrap_or((Decimal::ZERO,));

    let total_g_volume: (Decimal,) = sqlx::query_as(
        "SELECT COALESCE(SUM(amount), 0) FROM g_ledger WHERE created_at >= $1 AND created_at < $2",
    )
    .bind(starts_at).bind(window_end)
    .fetch_one(&state.db).await.unwrap_or((Decimal::ZERO,));

    HttpResponse::Ok().json(AdminStats {
        season_name,
        starts_at,
        ends_at,
        new_players: new_players.0,
        active_players: active_players.0,
        total_battles: total_battles.0,
        total_g_awarded: total_g_awarded.0,
        total_g_volume: total_g_volume.0,
    })
}

// ── Seasons: GET/POST /admin/seasons, POST /admin/seasons/:id/end ─────────────
#[derive(Serialize, sqlx::FromRow)]
pub struct SeasonRow {
    pub id: Uuid,
    pub name: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
}

pub async fn list_seasons(req: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) {
        return resp;
    }
    let rows = sqlx::query_as::<_, SeasonRow>(
        "SELECT id, name, starts_at, ends_at FROM seasons ORDER BY starts_at DESC",
    )
    .fetch_all(&state.db)
    .await;

    match rows {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => {
            tracing::error!("Failed to list seasons: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

#[derive(Deserialize)]
pub struct CreateSeasonRequest {
    pub name: String,
}

pub async fn create_season(
    req: HttpRequest,
    state: web::Data<AppState>,
    body: web::Json<CreateSeasonRequest>,
) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) {
        return resp;
    }
    if body.name.trim().is_empty() {
        return HttpResponse::BadRequest().json(json!({"error": "Season name required"}));
    }

    // Only one season is ever open at a time — close whatever's currently running.
    let _ = sqlx::query("UPDATE seasons SET ends_at = now() WHERE ends_at IS NULL")
        .execute(&state.db)
        .await;

    let row = sqlx::query_as::<_, SeasonRow>(
        "INSERT INTO seasons (name, starts_at) VALUES ($1, now()) RETURNING id, name, starts_at, ends_at",
    )
    .bind(body.name.trim())
    .fetch_one(&state.db)
    .await;

    match row {
        Ok(season) => HttpResponse::Ok().json(season),
        Err(e) => {
            tracing::error!("Failed to create season: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

pub async fn end_season(
    req: HttpRequest,
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) {
        return resp;
    }
    let row = sqlx::query_as::<_, SeasonRow>(
        "UPDATE seasons SET ends_at = now() WHERE id = $1 AND ends_at IS NULL
         RETURNING id, name, starts_at, ends_at",
    )
    .bind(path.into_inner())
    .fetch_optional(&state.db)
    .await;

    match row {
        Ok(Some(season)) => HttpResponse::Ok().json(season),
        Ok(None) => HttpResponse::NotFound().json(json!({"error": "Season not found or already ended"})),
        Err(e) => {
            tracing::error!("Failed to end season: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}
