use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::handlers::admin::verify_admin_token;
use crate::AppState;

#[derive(FromRow)]
struct ReferralCampaignRow {
    id: Uuid,
    name: String,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct LeaderboardRow {
    wallet_address: String,
    character_name: Option<String>,
    username: Option<String>,
    referral_count: i64,
}

// ── GET /campaigns/referrals/current ────────────────────────────────────────
// Public. The referral campaign that's live right now (falling back to the
// most recently started one, so a just-ended campaign keeps showing its final
// board), plus the ranked leaderboard within its window. Mirrors seasons::current.
pub async fn current(state: web::Data<AppState>) -> HttpResponse {
    let campaign: Option<ReferralCampaignRow> = sqlx::query_as::<_, ReferralCampaignRow>(
        "SELECT id, name, starts_at, ends_at FROM referral_campaigns
         ORDER BY (starts_at <= now() AND ends_at >= now()) DESC, starts_at DESC
         LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let Some(campaign) = campaign else {
        return HttpResponse::Ok().json(json!({ "campaign": null, "leaderboard": [] }));
    };

    // Ranked by referrals recorded inside the campaign's window. Excludes
    // fraud_blocked rows — the same status the farming-exploit fix flips
    // fake referrals to — so a sybil sweep never leaves a fraudster on the board.
    let rows: Vec<LeaderboardRow> = sqlx::query_as::<_, LeaderboardRow>(
        "SELECT r.referrer_wallet AS wallet_address, p.character_name, p.username,
                COUNT(*)::bigint AS referral_count
         FROM referrals r
         LEFT JOIN players p ON p.wallet_address = r.referrer_wallet
         WHERE r.created_at >= $1 AND r.created_at <= $2 AND r.status <> 'fraud_blocked'
         GROUP BY r.referrer_wallet, p.character_name, p.username
         ORDER BY referral_count DESC, MIN(r.created_at) ASC
         LIMIT 100",
    )
    .bind(campaign.starts_at)
    .bind(campaign.ends_at)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let now = Utc::now();
    let entries: Vec<_> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            json!({
                "rank": i + 1,
                "wallet_address": r.wallet_address,
                "character_name": r.character_name,
                "username": r.username,
                "referral_count": r.referral_count,
            })
        })
        .collect();

    HttpResponse::Ok().json(json!({
        "campaign": {
            "id": campaign.id,
            "name": campaign.name,
            "starts_at": campaign.starts_at.to_rfc3339(),
            "ends_at": campaign.ends_at.to_rfc3339(),
            "active": campaign.starts_at <= now && campaign.ends_at >= now,
            "upcoming": campaign.starts_at > now,
            "ended": campaign.ends_at < now,
        },
        "leaderboard": entries,
    }))
}

#[derive(Deserialize)]
pub struct CreateReferralCampaignRequest {
    pub name: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
}

// ── POST /admin/campaigns/referrals ─────────────────────────────────────────
// Admin. Launching the next referral campaign is inserting a row, not a
// redeploy — this is the row-inserter.
pub async fn create(
    req: HttpRequest,
    state: web::Data<AppState>,
    body: web::Json<CreateReferralCampaignRequest>,
) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) {
        return resp;
    }
    if body.name.trim().is_empty() {
        return HttpResponse::BadRequest().json(json!({"error": "Campaign name required"}));
    }
    if body.ends_at <= body.starts_at {
        return HttpResponse::BadRequest().json(json!({"error": "Campaign must end after it starts"}));
    }

    let row = sqlx::query_as::<_, ReferralCampaignRow>(
        "INSERT INTO referral_campaigns (name, starts_at, ends_at) VALUES ($1, $2, $3)
         RETURNING id, name, starts_at, ends_at",
    )
    .bind(body.name.trim())
    .bind(body.starts_at)
    .bind(body.ends_at)
    .fetch_one(&state.db)
    .await;

    match row {
        Ok(c) => HttpResponse::Ok().json(json!({
            "id": c.id, "name": c.name,
            "starts_at": c.starts_at.to_rfc3339(), "ends_at": c.ends_at.to_rfc3339(),
        })),
        Err(e) => {
            tracing::error!("create referral campaign failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /admin/campaigns/referrals ──────────────────────────────────────────
pub async fn list(req: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) {
        return resp;
    }
    let rows = sqlx::query_as::<_, ReferralCampaignRow>(
        "SELECT id, name, starts_at, ends_at FROM referral_campaigns ORDER BY starts_at DESC",
    )
    .fetch_all(&state.db)
    .await;

    match rows {
        Ok(rows) => HttpResponse::Ok().json(
            rows.iter()
                .map(|c| {
                    json!({
                        "id": c.id, "name": c.name,
                        "starts_at": c.starts_at.to_rfc3339(), "ends_at": c.ends_at.to_rfc3339(),
                    })
                })
                .collect::<Vec<_>>(),
        ),
        Err(e) => {
            tracing::error!("list referral campaigns failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}
