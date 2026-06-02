use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Serialize)]
pub struct VerifyResponse {
    verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    face_verify_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub async fn verify_identity(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();

    // Check if player already exists in DB (already verified)
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT wallet_address FROM players WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    if existing.is_some() {
        return HttpResponse::Ok().json(VerifyResponse {
            verified: true,
            face_verify_url: None,
            error: None,
        });
    }

    // Call GoodDollar whitelist check via citizen-sdk API
    // In production: use the GoodDollar whitelist contract on Celo
    let good_dollar_api = std::env::var("GOOD_DOLLAR_API_URL")
        .unwrap_or_else(|_| "https://gooddollar-api.gooddollar.org".into());

    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/verify/{}", good_dollar_api, wallet))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            let is_whitelisted = body["whitelisted"].as_bool().unwrap_or(false);

            if is_whitelisted {
                HttpResponse::Ok().json(VerifyResponse {
                    verified: true,
                    face_verify_url: None,
                    error: None,
                })
            } else {
                let verify_url = format!(
                    "https://wallet.gooddollar.org/face-verification?wallet={}",
                    wallet
                );
                HttpResponse::Ok().json(VerifyResponse {
                    verified: false,
                    face_verify_url: Some(verify_url),
                    error: None,
                })
            }
        }
        _ => HttpResponse::Ok().json(VerifyResponse {
            verified: false,
            face_verify_url: None,
            error: Some("Failed to check GoodDollar whitelist".into()),
        }),
    }
}
