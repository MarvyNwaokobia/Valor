use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use ethers::types::Address;
use serde::Deserialize;
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::handlers::admin::verify_admin_token;
use crate::handlers::seasons::{payout_split, PAYOUT_BPS};
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
// Includes prize_pool_g/payout_status so the admin payout UI can list every
// campaign without a preview round-trip per row just to know what is funded.
pub async fn list(req: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) {
        return resp;
    }
    let rows = sqlx::query_as::<_, ReferralCampaignMeta>(
        "SELECT id, name, starts_at, ends_at, prize_pool_g, payout_status, payout_bps
         FROM referral_campaigns ORDER BY starts_at DESC",
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
                        "prize_pool_g": c.prize_pool_g, "payout_status": c.payout_status,
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

// ── Payout ───────────────────────────────────────────────────────────────────
//
// 2026-08-25: referrals stopped minting G$ on signup (see credit_referral in
// players.rs) — a flat per-signup reward was the entire exploit surface for the
// 2026-08-16 farming bot. Money now only moves here: an admin funds a campaign's
// prize pool and, once it has closed, pays it out top-heavy across the referral
// leaderboard, the exact same rail seasons already use (`seasons::payout_split`,
// `seasons::PAYOUT_BPS`). Everything below mirrors seasons.rs's fund/preview/pay
// trio on purpose — one proven pattern for "pay a closed leaderboard", not two.

#[derive(FromRow)]
struct ReferralCampaignMeta {
    id: Uuid,
    name: String,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    prize_pool_g: i64,
    payout_status: String,
    payout_bps: Option<Vec<i32>>,
}

async fn campaign_leaderboard(db: &sqlx::PgPool, c: &ReferralCampaignMeta, limit: i64) -> Vec<LeaderboardRow> {
    sqlx::query_as::<_, LeaderboardRow>(
        "SELECT r.referrer_wallet AS wallet_address, p.character_name, p.username,
                COUNT(*)::bigint AS referral_count
         FROM referrals r
         LEFT JOIN players p ON p.wallet_address = r.referrer_wallet
         WHERE r.created_at >= $1 AND r.created_at <= $2 AND r.status <> 'fraud_blocked'
         GROUP BY r.referrer_wallet, p.character_name, p.username
         ORDER BY referral_count DESC, MIN(r.created_at) ASC
         LIMIT $3",
    )
    .bind(c.starts_at)
    .bind(c.ends_at)
    .bind(limit)
    .fetch_all(db)
    .await
    .unwrap_or_default()
}

#[derive(Deserialize)]
pub struct FundReferralCampaignRequest {
    pub prize_pool_g: i64,
}

// ── POST /admin/campaigns/referrals/:id/fund ────────────────────────────────
// Admin. Sets a campaign's G$ prize pool. (Funding the on-chain RewardPool
// balance is separate — this just sets what the split divides.)
pub async fn fund(req: HttpRequest, state: web::Data<AppState>, path: web::Path<Uuid>, body: web::Json<FundReferralCampaignRequest>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) { return resp; }
    if body.prize_pool_g < 0 {
        return HttpResponse::BadRequest().json(json!({"error": "prize_pool_g cannot be negative"}));
    }
    let row = sqlx::query("UPDATE referral_campaigns SET prize_pool_g = $1 WHERE id = $2")
        .bind(body.prize_pool_g).bind(path.into_inner()).execute(&state.db).await;
    match row {
        Ok(r) if r.rows_affected() == 1 => HttpResponse::Ok().json(json!({"ok": true, "prize_pool_g": body.prize_pool_g})),
        Ok(_) => HttpResponse::NotFound().json(json!({"error": "Campaign not found"})),
        Err(e) => {
            tracing::error!("fund referral campaign failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /admin/campaigns/referrals/:id/payout-preview ───────────────────────
// Admin, READ-ONLY. Mirrors seasons::payout_preview exactly: same board + split
// the payout would run, so this is a confirmation rather than a guess. Once a
// payout has started, reports the real committed rows instead of a fresh
// computation, so a resumed payout shows what is actually left.
pub async fn payout_preview(req: HttpRequest, state: web::Data<AppState>, path: web::Path<Uuid>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) { return resp; }
    let campaign_id = path.into_inner();

    let campaign: Option<ReferralCampaignMeta> = sqlx::query_as::<_, ReferralCampaignMeta>(
        "SELECT id, name, starts_at, ends_at, prize_pool_g, payout_status, payout_bps FROM referral_campaigns WHERE id = $1",
    )
    .bind(campaign_id).fetch_optional(&state.db).await.ok().flatten();
    let Some(campaign) = campaign else {
        return HttpResponse::NotFound().json(json!({"error": "Campaign not found"}));
    };

    let committed: Vec<(String, Option<String>, i32, i32, i64, String, Option<String>)> = sqlx::query_as(
        "SELECT cp.wallet_address, p.username, cp.rank, cp.referral_count, cp.amount_g, cp.status, cp.tx_hash
         FROM referral_campaign_payouts cp LEFT JOIN players p ON p.wallet_address = cp.wallet_address
         WHERE cp.campaign_id = $1 ORDER BY cp.rank ASC",
    )
    .bind(campaign_id).fetch_all(&state.db).await.unwrap_or_default();

    let winners: Vec<serde_json::Value> = if committed.is_empty() {
        let board = campaign_leaderboard(&state.db, &campaign, PAYOUT_BPS.len() as i64).await;
        let split = payout_split(campaign.prize_pool_g.max(0) as u64, board.len(), campaign.payout_bps.as_deref());
        board.iter().enumerate()
            .filter_map(|(i, e)| {
                let amount = split.get(i).copied().unwrap_or(0);
                if amount == 0 { return None; } // mirrors the payout's own "no dust rows" skip
                Some(json!({
                    "rank": i + 1, "wallet_address": e.wallet_address, "username": e.username,
                    "referral_count": e.referral_count, "amount_g": amount, "status": "pending", "tx_hash": null,
                }))
            })
            .collect()
    } else {
        committed.iter().map(|(w, u, r, count, amt, st, tx)| json!({
            "rank": r, "wallet_address": w, "username": u,
            "referral_count": count, "amount_g": amt, "status": st, "tx_hash": tx,
        })).collect()
    };

    let total_g: i64 = winners.iter().filter_map(|w| w["amount_g"].as_i64()).sum();
    let unpaid_g: i64 = winners.iter()
        .filter(|w| w["status"].as_str() != Some("paid"))
        .filter_map(|w| w["amount_g"].as_i64())
        .sum();

    const MAX_CHUNK_G: i64 = 10_000; // mirrors ValorRewardPool.MAX_REWARD
    let tx_count: i64 = winners.iter()
        .filter(|w| w["status"].as_str() != Some("paid"))
        .filter_map(|w| w["amount_g"].as_i64())
        .map(|a| (a + MAX_CHUNK_G - 1) / MAX_CHUNK_G)
        .sum();

    let (pool_balance_g, pool_address, relay_celo) = match state.chain.as_ref() {
        Some(chain) => {
            let addr = chain.reward_pool_address();
            let bal = match addr {
                Some(a) => chain.g_balance(a).await.ok().map(|b| (b / ethers::types::U256::exp10(18)).as_u64() as i64),
                None => None,
            };
            let celo = chain.celo_balance(chain.relay_address()).await.ok()
                .map(|c| c.as_u128() as f64 / 1e18);
            (bal, addr.map(|a| format!("{:?}", a)), celo)
        }
        None => (None, None, None),
    };

    let now = Utc::now();
    let closed = campaign.ends_at <= now;

    HttpResponse::Ok().json(json!({
        "campaign": {
            "id": campaign.id, "name": campaign.name,
            "ends_at": campaign.ends_at.to_rfc3339(),
            "prize_pool_g": campaign.prize_pool_g,
            "payout_status": campaign.payout_status,
            "closed": closed,
        },
        "winners": winners,
        "winner_count": winners.len(),
        "total_g": total_g,
        "unpaid_g": unpaid_g,
        "tx_count": tx_count,
        "pool_address": pool_address,
        "pool_balance_g": pool_balance_g,
        "funded": pool_balance_g.map(|b| b >= unpaid_g).unwrap_or(false),
        "relay_celo": relay_celo,
        "can_pay": closed && pool_balance_g.map(|b| b >= unpaid_g).unwrap_or(false) && unpaid_g > 0,
    }))
}

// ── POST /admin/campaigns/referrals/:id/payout ───────────────────────────────
// Admin, MONEY-TOUCHING. Computes the top referrers in a CLOSED campaign, writes
// the payout ledger (idempotent), and distributes G$ on-chain. Safe to re-run:
// winners are computed once (PK on campaign+wallet), and each transfer is
// guarded by its on-chain ref so re-running only re-attempts unpaid rows.
pub async fn payout(req: HttpRequest, state: web::Data<AppState>, path: web::Path<Uuid>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) { return resp; }
    let campaign_id = path.into_inner();

    let campaign: Option<ReferralCampaignMeta> = sqlx::query_as::<_, ReferralCampaignMeta>(
        "SELECT id, name, starts_at, ends_at, prize_pool_g, payout_status, payout_bps FROM referral_campaigns WHERE id = $1",
    )
    .bind(campaign_id).fetch_optional(&state.db).await.ok().flatten();
    let Some(campaign) = campaign else {
        return HttpResponse::NotFound().json(json!({"error": "Campaign not found"}));
    };
    // Winners are frozen on the first run below and every chunk burns a one-shot
    // on-chain reference, so a payout that ran mid-campaign could never pay the
    // referrals that came in afterward. Refuse until the window has actually closed.
    if campaign.ends_at > Utc::now() {
        return HttpResponse::BadRequest().json(json!({
            "error": "Campaign is still running — it closes at its scheduled time",
            "ends_at": campaign.ends_at.to_rfc3339(),
        }));
    }
    let Some(chain) = state.chain.as_ref().cloned() else {
        return HttpResponse::ServiceUnavailable().json(json!({"error": "Chain relay not available"}));
    };

    let already: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM referral_campaign_payouts WHERE campaign_id = $1")
        .bind(campaign_id).fetch_one(&state.db).await.unwrap_or(0);
    if already == 0 {
        let board = campaign_leaderboard(&state.db, &campaign, PAYOUT_BPS.len() as i64).await;
        let split = payout_split(campaign.prize_pool_g.max(0) as u64, board.len(), campaign.payout_bps.as_deref());
        for (i, e) in board.iter().enumerate() {
            let amount = split.get(i).copied().unwrap_or(0);
            if amount == 0 { continue; } // no dust rows
            let _ = sqlx::query(
                "INSERT INTO referral_campaign_payouts (campaign_id, wallet_address, rank, referral_count, amount_g)
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
            )
            .bind(campaign_id).bind(&e.wallet_address).bind((i + 1) as i32).bind(e.referral_count as i32).bind(amount as i64)
            .execute(&state.db).await;
        }
    }

    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT wallet_address, amount_g FROM referral_campaign_payouts WHERE campaign_id = $1 AND status <> 'paid' ORDER BY rank ASC",
    )
    .bind(campaign_id).fetch_all(&state.db).await.unwrap_or_default();

    let attempted = rows.len();
    let mut paid = 0u32;
    for (wallet, amount) in rows {
        if settle_referral_campaign_payout(&state.db, &chain, campaign_id, &wallet, amount.max(0) as u64).await {
            paid += 1;
        }
    }

    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM referral_campaign_payouts WHERE campaign_id = $1 AND status <> 'paid'")
        .bind(campaign_id).fetch_one(&state.db).await.unwrap_or(1);
    if remaining == 0 {
        let _ = sqlx::query("UPDATE referral_campaigns SET payout_status = 'paid' WHERE id = $1").bind(campaign_id).execute(&state.db).await;
    }

    tracing::info!("referral campaign {} payout: {}/{} settled, {} still unpaid", campaign.name, paid, attempted, remaining);
    HttpResponse::Ok().json(json!({
        "ok": true, "attempted": attempted, "paid": paid,
        "still_unpaid": remaining, "campaign_paid": remaining == 0,
    }))
}

/// Distribute one campaign winner's prize on-chain + reconcile the row/ledger.
/// Mirrors seasons::settle_season_payout, chunked the same way for
/// ValorRewardPool.MAX_REWARD, and gated by the same fraud blocklist every other
/// payout rail checks before a distribute_reward call.
async fn settle_referral_campaign_payout(
    db: &sqlx::PgPool,
    chain: &crate::services::chain::ChainWriter,
    campaign_id: Uuid,
    wallet: &str,
    amount: u64,
) -> bool {
    if crate::services::fraud_blocklist::is_blocked_str(wallet) {
        tracing::warn!("referral campaign payout BLOCKED (confirmed fraud wallet): {} owed {} G$, permanently refusing", wallet, amount);
        let _ = sqlx::query("UPDATE referral_campaign_payouts SET status = 'failed' WHERE campaign_id = $1 AND wallet_address = $2")
            .bind(campaign_id).bind(wallet).execute(db).await;
        return false;
    }
    let Ok(addr) = wallet.parse::<Address>() else { return false; };

    const MAX_CHUNK_G: u64 = 10_000; // mirrors ValorRewardPool.MAX_REWARD
    let mut chunks: Vec<u64> = Vec::new();
    let mut left = amount;
    while left > 0 {
        let take = left.min(MAX_CHUNK_G);
        chunks.push(take);
        left -= take;
    }

    let mut last_hash: Option<String> = None;
    let mut all_ok = true;
    for (i, chunk) in chunks.iter().enumerate() {
        let reference = ethers::utils::keccak256(
            format!("referral_campaign_payout:{}:{}:{}", campaign_id, wallet, i).as_bytes(),
        );
        let already = chain.reward_ref_used(reference).await.unwrap_or(false);
        let result = if already {
            Ok(Some(None))
        } else {
            chain.distribute_reward(addr, *chunk, reference).await.map(|r| r.map(Some))
        };
        match result {
            Ok(Some(h)) => { if h.is_some() { last_hash = h; } }
            Ok(None) | Err(_) => {
                tracing::error!(
                    "referral campaign payout chunk {}/{} FAILED for {} ({} G$) — re-run the payout to resume",
                    i + 1, chunks.len(), wallet, chunk,
                );
                all_ok = false;
                break;
            }
        }
    }

    if !all_ok {
        let _ = sqlx::query("UPDATE referral_campaign_payouts SET status = 'failed' WHERE campaign_id = $1 AND wallet_address = $2")
            .bind(campaign_id).bind(wallet).execute(db).await;
        return false;
    }

    let _ = sqlx::query("UPDATE referral_campaign_payouts SET status = 'paid', tx_hash = COALESCE($3, tx_hash) WHERE campaign_id = $1 AND wallet_address = $2")
        .bind(campaign_id).bind(wallet).bind(&last_hash).execute(db).await;
    let credited_locally = sqlx::query("UPDATE players SET g_earned_lifetime = g_earned_lifetime + $1 WHERE wallet_address = $2")
        .bind(amount as i64).bind(wallet).execute(db).await;
    crate::handlers::battles::log_write_failure("referral campaign g_earned_lifetime credit", wallet, &credited_locally);
    crate::handlers::ledger::insert_ledger_entry(
        db, wallet, "referral_campaign_reward", rust_decimal::Decimal::from(amount), last_hash.as_deref(), None,
        crate::services::chain_id::ChainId::Celo,
    ).await;
    tracing::info!("referral campaign payout paid: {} +{} G$ in {} tx", wallet, amount, chunks.len());
    true
}
