use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use ethers::types::{Address, Signature};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::AppState;

/// Player session claims — a distinct JWT (separate secret, `role: "player"`)
/// from the admin JWT in `handlers::admin`, so the two can never be confused
/// for one another. `sub` is the normalized wallet the signature proved
/// ownership of.
#[derive(Serialize, Deserialize)]
struct PlayerClaims {
    sub: String,
    role: String,
    exp: u64,
    iat: u64,
}

/// Checks that the request carries a valid player JWT AND that the JWT's
/// wallet matches `expected_wallet` (normally the `{wallet}` path segment).
/// Fails closed: any missing/invalid/expired token or wallet mismatch is an
/// error response, never a silent pass.
pub fn verify_player_token(req: &HttpRequest, expected_wallet: &str) -> Result<(), HttpResponse> {
    let jwt_secret = std::env::var("PLAYER_JWT_SECRET").map_err(|_| {
        HttpResponse::ServiceUnavailable().json(json!({"error": "Player auth not configured"}))
    })?;

    let token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| HttpResponse::Unauthorized().json(json!({"error": "Missing or malformed Authorization header"})))?;

    let data = decode::<PlayerClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| HttpResponse::Unauthorized().json(json!({"error": "Invalid or expired session"})))?;

    if data.claims.role != "player" {
        return Err(HttpResponse::Unauthorized().json(json!({"error": "Not a player session"})));
    }

    if data.claims.sub != normalize_wallet(expected_wallet) {
        return Err(HttpResponse::Forbidden().json(json!({"error": "Session does not match this wallet"})));
    }

    Ok(())
}

// ── POST /players/login ────────────────────────────────────────────────────────
// Verifies a wallet signature over a message embedding a fresh timestamp
// (prevents replaying an old signature) and issues a long-lived player JWT.
// Unlike admin login there's no allowlist — any valid wallet can get a token
// proving ownership of itself.
#[derive(Deserialize)]
pub struct PlayerLoginRequest {
    pub wallet: String,
    pub message: String,
    pub signature: String,
}

pub async fn login(req: HttpRequest, state: web::Data<AppState>, body: web::Json<PlayerLoginRequest>) -> HttpResponse {
    let ip = req.connection_info().realip_remote_addr().unwrap_or("unknown").to_string();
    if !state.battle_limiter.check(&format!("player_login_ip:{}", ip)) {
        return HttpResponse::TooManyRequests().json(json!({"error": "Too many requests. Slow down."}));
    }

    let jwt_secret = match std::env::var("PLAYER_JWT_SECRET") {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::ServiceUnavailable()
                .json(json!({"error": "Player auth not configured (PLAYER_JWT_SECRET missing)"}))
        }
    };

    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet_norm = normalize_wallet(&body.wallet);

    if !state.battle_limiter.check(&format!("player_login_wallet:{}", wallet_norm)) {
        return HttpResponse::TooManyRequests().json(json!({"error": "Too many requests. Slow down."}));
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
    let expires_in: u64 = 60 * 60 * 24; // 24 hours — players stay in session far longer than admins
    let claims = PlayerClaims { sub: wallet_norm.clone(), role: "player".into(), exp: now + expires_in, iat: now };

    let token = match encode(&Header::default(), &claims, &EncodingKey::from_secret(jwt_secret.as_bytes())) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Player JWT encode failed: {}", e);
            return HttpResponse::InternalServerError().json(json!({"error": "Failed to issue token"}));
        }
    };

    HttpResponse::Ok().json(json!({ "token": token, "wallet": wallet_norm, "expires_at": now + expires_in }))
}
