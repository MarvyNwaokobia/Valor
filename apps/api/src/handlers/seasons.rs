use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use ethers::types::Address;
use serde::Serialize;
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::AppState;
use crate::handlers::admin::verify_admin_token;

// Top-heavy long-tail prize split, in basis points of the pool, by 1-based rank.
// Sums to 10000 (100%) across the top 20. Winners past the table get nothing;
// unclaimed shares (fewer than 20 winners) simply stay in the pool for next season.
const PAYOUT_BPS: &[u64] = &[
    3000, 1800, 1200, 800, 600, // 1-5  → 74%
    300, 300, 300, 300, 300,    // 6-10 → 15%
    110, 110, 110, 110, 110,    // 11-20 → 11%
    110, 110, 110, 110, 110,
];

/// Whole-G$ prize for each of `n` winners from a `pool_g` pool. Rank i (0-based)
/// gets floor(pool * bps[i] / 10000); ranks beyond the table get 0.
fn payout_split(pool_g: u64, n: usize) -> Vec<u64> {
    (0..n)
        .map(|i| PAYOUT_BPS.get(i).map_or(0, |bps| pool_g.saturating_mul(*bps) / 10_000))
        .collect()
}

#[derive(FromRow)]
struct SeasonMeta {
    id: Uuid,
    name: String,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    prize_pool_g: i64,
    payout_status: String,
}

#[derive(Serialize, FromRow)]
struct BoardEntry {
    wallet_address: String,
    username: Option<String>,
    best: i32,
}

/// Best Gauntlet run per wallet WITHIN a season's window (submitted between its start
/// and end, or now if still open), ranked. The seasonal ladder that payouts settle.
async fn season_board(db: &sqlx::PgPool, s: &SeasonMeta, limit: i64) -> Vec<BoardEntry> {
    sqlx::query_as::<_, BoardEntry>(
        "SELECT r.wallet_address, p.username, MAX(r.waves) AS best
         FROM survival_runs r LEFT JOIN players p ON p.wallet_address = r.wallet_address
         WHERE r.status = 'submitted'
           AND r.submitted_at >= $1
           AND ($2::timestamptz IS NULL OR r.submitted_at <= $2)
         GROUP BY r.wallet_address, p.username
         ORDER BY best DESC, MIN(r.submitted_at) ASC
         LIMIT $3",
    )
    .bind(s.starts_at).bind(s.ends_at).bind(limit)
    .fetch_all(db).await.unwrap_or_default()
}

// ── GET /seasons/current ───────────────────────────────────────────────────────
// Public: the live season — its prize pool, the leaderboard within its window, and
// the estimated payout each rank would earn if the season closed now. This is what
// makes the competition legible ("play the Gauntlet, here's what's on the line").
pub async fn current(state: web::Data<AppState>) -> HttpResponse {
    // The active season (ends_at NULL), else the most recent.
    let season: Option<SeasonMeta> = sqlx::query_as::<_, SeasonMeta>(
        "SELECT id, name, starts_at, ends_at, prize_pool_g, payout_status
         FROM seasons ORDER BY (ends_at IS NULL) DESC, starts_at DESC LIMIT 1",
    )
    .fetch_optional(&state.db).await.ok().flatten();

    let Some(season) = season else {
        return HttpResponse::Ok().json(json!({ "season": null }));
    };

    let board = season_board(&state.db, &season, 25).await;
    let split = payout_split(season.prize_pool_g.max(0) as u64, board.len());
    let entries: Vec<_> = board.iter().enumerate().map(|(i, e)| json!({
        "rank": i + 1,
        "wallet_address": e.wallet_address,
        "username": e.username,
        "best": e.best,
        "est_payout_g": split.get(i).copied().unwrap_or(0),
    })).collect();

    HttpResponse::Ok().json(json!({
        "season": {
            "id": season.id,
            "name": season.name,
            "starts_at": season.starts_at.to_rfc3339(),
            "ends_at": season.ends_at.map(|d| d.to_rfc3339()),
            "active": season.ends_at.is_none(),
            "prize_pool_g": season.prize_pool_g,
            "payout_status": season.payout_status,
        },
        "leaderboard": entries,
    }))
}

// ── POST /admin/seasons/:id/fund ───────────────────────────────────────────────
// Admin: set a season's G$ prize pool. (Funding the on-chain RewardPool balance is
// separate — this just records how much of it this season pays out.)
#[derive(serde::Deserialize)]
pub struct FundRequest { pub prize_pool_g: i64 }

pub async fn fund(req: HttpRequest, state: web::Data<AppState>, path: web::Path<Uuid>, body: web::Json<FundRequest>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) { return resp; }
    if body.prize_pool_g < 0 {
        return HttpResponse::BadRequest().json(json!({"error": "Prize pool must be ≥ 0"}));
    }
    let row = sqlx::query("UPDATE seasons SET prize_pool_g = $1 WHERE id = $2")
        .bind(body.prize_pool_g).bind(path.into_inner())
        .execute(&state.db).await;
    match row {
        Ok(r) if r.rows_affected() == 1 => HttpResponse::Ok().json(json!({"ok": true, "prize_pool_g": body.prize_pool_g})),
        Ok(_) => HttpResponse::NotFound().json(json!({"error": "Season not found"})),
        Err(e) => { tracing::error!("season fund failed: {}", e); HttpResponse::InternalServerError().json(json!({"error": "Database error"})) }
    }
}

// ── POST /admin/seasons/:id/payout ─────────────────────────────────────────────
// Admin, MONEY-TOUCHING. Computes the top runs in a CLOSED season, writes the payout
// ledger (idempotent), and distributes G$ on-chain via the RewardPool. Safe to re-run:
// winners are computed once (PK), and each transfer is guarded by the on-chain ref so
// re-running only re-attempts rows that haven't paid yet (a built-in reconcile).
pub async fn payout(req: HttpRequest, state: web::Data<AppState>, path: web::Path<Uuid>) -> HttpResponse {
    if let Err(resp) = verify_admin_token(&req) { return resp; }
    let season_id = path.into_inner();

    let season: Option<SeasonMeta> = sqlx::query_as::<_, SeasonMeta>(
        "SELECT id, name, starts_at, ends_at, prize_pool_g, payout_status FROM seasons WHERE id = $1",
    )
    .bind(season_id).fetch_optional(&state.db).await.ok().flatten();
    let Some(season) = season else {
        return HttpResponse::NotFound().json(json!({"error": "Season not found"}));
    };
    if season.ends_at.is_none() {
        return HttpResponse::BadRequest().json(json!({"error": "End the season before paying it out"}));
    }
    let Some(chain) = state.chain.as_ref().cloned() else {
        return HttpResponse::ServiceUnavailable().json(json!({"error": "Chain relay not available"}));
    };

    // Compute winners exactly once — the PK makes the INSERT a no-op on re-run.
    let already: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM season_payouts WHERE season_id = $1")
        .bind(season_id).fetch_one(&state.db).await.unwrap_or(0);
    if already == 0 {
        let board = season_board(&state.db, &season, PAYOUT_BPS.len() as i64).await;
        let split = payout_split(season.prize_pool_g.max(0) as u64, board.len());
        for (i, e) in board.iter().enumerate() {
            let amount = split.get(i).copied().unwrap_or(0);
            if amount == 0 { continue; } // no dust rows
            let _ = sqlx::query(
                "INSERT INTO season_payouts (season_id, wallet_address, rank, waves, amount_g)
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
            )
            .bind(season_id).bind(&e.wallet_address).bind((i + 1) as i32).bind(e.best).bind(amount as i64)
            .execute(&state.db).await;
        }
    }

    // (Re)attempt every not-yet-paid payout on-chain.
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT wallet_address, amount_g FROM season_payouts WHERE season_id = $1 AND status <> 'paid' ORDER BY rank ASC",
    )
    .bind(season_id).fetch_all(&state.db).await.unwrap_or_default();

    let attempted = rows.len();
    let mut paid = 0u32;
    for (wallet, amount) in rows {
        if settle_season_payout(&state.db, &chain, season_id, &wallet, amount.max(0) as u64).await {
            paid += 1;
        }
    }

    // Season is fully paid once nothing is left unpaid.
    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM season_payouts WHERE season_id = $1 AND status <> 'paid'")
        .bind(season_id).fetch_one(&state.db).await.unwrap_or(1);
    if remaining == 0 {
        let _ = sqlx::query("UPDATE seasons SET payout_status = 'paid' WHERE id = $1").bind(season_id).execute(&state.db).await;
    }

    tracing::info!("season {} payout: {}/{} settled, {} still unpaid", season.name, paid, attempted, remaining);
    HttpResponse::Ok().json(json!({
        "ok": true, "attempted": attempted, "paid": paid,
        "still_unpaid": remaining, "season_paid": remaining == 0,
    }))
}

/// Distribute one season prize on-chain + reconcile the row/ledger. Mirrors the
/// first-clear bounty settle: an on-chain `ref` keyed to (season, wallet) makes every
/// re-attempt idempotent, and an already-used ref reconciles to paid without gas.
async fn settle_season_payout(
    db: &sqlx::PgPool,
    chain: &crate::services::chain::ChainWriter,
    season_id: Uuid,
    wallet: &str,
    amount: u64,
) -> bool {
    let Ok(addr) = wallet.parse::<Address>() else { return false; };
    let reference = ethers::utils::keccak256(format!("season_payout:{}:{}", season_id, wallet).as_bytes());
    let already = chain.reward_ref_used(reference).await.unwrap_or(false);
    let result = if already { Ok(true) } else { chain.distribute_reward(addr, amount, reference).await };
    match result {
        Ok(true) => {
            let _ = sqlx::query("UPDATE season_payouts SET status = 'paid' WHERE season_id = $1 AND wallet_address = $2")
                .bind(season_id).bind(wallet).execute(db).await;
            let _ = sqlx::query("UPDATE players SET g_earned_lifetime = g_earned_lifetime + $1 WHERE wallet_address = $2")
                .bind(amount as i64).bind(wallet).execute(db).await;
            crate::handlers::ledger::insert_ledger_entry(
                db, wallet, "season_reward", rust_decimal::Decimal::from(amount), None, None,
            ).await;
            tracing::info!("season payout paid: {} +{} G${}", wallet, amount, if already { " (reconciled)" } else { "" });
            true
        }
        Ok(false) | Err(_) => {
            let _ = sqlx::query("UPDATE season_payouts SET status = 'failed' WHERE season_id = $1 AND wallet_address = $2")
                .bind(season_id).bind(wallet).execute(db).await;
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_is_top_heavy_and_within_pool() {
        let s = payout_split(1000, 20);
        assert_eq!(s[0], 300); // 30%
        assert_eq!(s[1], 180); // 18%
        assert!(s[0] > s[1] && s[1] > s[2]);           // strictly top-heavy
        assert!(s.iter().sum::<u64>() <= 1000);         // never over-pays
        assert_eq!(s.iter().sum::<u64>(), 1000);        // full pool across 20
    }

    #[test]
    fn fewer_winners_leave_the_rest_in_pool() {
        let s = payout_split(1000, 3);
        assert_eq!(s, vec![300, 180, 120]);
        assert!(s.iter().sum::<u64>() < 1000); // unclaimed stays in pool
    }

    #[test]
    fn empty_and_zero_are_safe() {
        assert!(payout_split(1000, 0).is_empty());
        assert_eq!(payout_split(0, 5), vec![0, 0, 0, 0, 0]);
    }

    #[test]
    fn winners_past_the_table_get_nothing() {
        let s = payout_split(1_000_000, 25);
        assert_eq!(s.len(), 25);
        assert_eq!(s[20], 0); // rank 21 → beyond the 20-deep table
    }
}
