use actix_web::{web, HttpResponse};
use ethers::types::{Address, Signature};
use jsonwebtoken::{encode, Header, EncodingKey};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::utils::{is_valid_wallet, normalize_wallet};

#[derive(Deserialize)]
pub struct TokenRequest {
    pub wallet:    String,
    pub message:   String,
    pub signature: String,
}

/// JWT claims that Supabase accepts for Row Level Security.
/// `sub` becomes `auth.uid()` in RLS policies.
#[derive(Serialize)]
struct SupabaseClaims {
    sub:  String,   // wallet_address (lowercase) — used by RLS
    role: String,   // "authenticated"
    iss:  String,   // "supabase"
    aud:  String,   // "authenticated"
    exp:  u64,
    iat:  u64,
}

/// POST /auth/token
///
/// Verifies a wallet signature and issues a Supabase-compatible JWT.
/// The frontend sets this as the Supabase session so RLS policies can
/// verify wallet ownership via `auth.jwt()->>'sub' = wallet_address`.
pub async fn issue_token(body: web::Json<TokenRequest>) -> HttpResponse {
    let jwt_secret = match std::env::var("SUPABASE_JWT_SECRET") {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::ServiceUnavailable()
                .json(json!({"error": "Auth service not configured (SUPABASE_JWT_SECRET missing)"}))
        }
    };

    // ── Input validation ──────────────────────────────────────────────
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    if body.signature.len() < 130 {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid signature"}));
    }
    if body.message.len() > 512 {
        return HttpResponse::BadRequest().json(json!({"error": "Message too long"}));
    }

    let wallet_addr: Address = match body.wallet.parse() {
        Ok(a) => a,
        Err(_) => return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"})),
    };

    // ── Signature verification ────────────────────────────────────────
    let sig: Signature = match body.signature.parse() {
        Ok(s) => s,
        Err(_) => return HttpResponse::BadRequest().json(json!({"error": "Malformed signature"})),
    };

    // ethers v2: verify hashes message with Ethereum personal_sign prefix
    // matching wagmi's signMessage / Privy's signMessage behaviour
    if sig.verify(body.message.as_bytes(), wallet_addr).is_err() {
        return HttpResponse::Unauthorized().json(json!({"error": "Signature does not match wallet"}));
    }

    // ── Issue Supabase JWT ────────────────────────────────────────────
    let now = chrono::Utc::now().timestamp() as u64;
    let expires_in: u64 = 24 * 60 * 60; // 24 hours

    let claims = SupabaseClaims {
        sub:  normalize_wallet(&body.wallet),
        role: "authenticated".into(),
        iss:  "supabase".into(),
        aud:  "authenticated".into(),
        exp:  now + expires_in,
        iat:  now,
    };

    let token = match encode(
        &Header::default(),  // HS256
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    ) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("JWT encode failed: {}", e);
            return HttpResponse::InternalServerError()
                .json(json!({"error": "Failed to issue token"}));
        }
    };

    HttpResponse::Ok().json(json!({
        "token":      token,
        "wallet":     normalize_wallet(&body.wallet),
        "expires_at": now + expires_in,
    }))
}
