//! Self-audit: does the database still agree with itself?
//!
//! Every reward bug this codebase has shipped shared one property: it was INVISIBLE.
//! A stale `xp <= 999` CHECK constraint aborted the one write that persists rank
//! progress while every sibling write in the same request succeeded, so battles kept
//! recording, bounties kept paying and the campaign kept unlocking while one player's
//! rank sat frozen for 18 hours. Nobody found out until a human played and noticed.
//!
//! This endpoint runs the queries that WOULD have caught it, in seconds, and reports
//! anything that disagrees. The cron calls it on a schedule and fails its job when the
//! report is non-empty, which is what turns "a player eventually complains" into "an
//! email arrives". It only ever READS; it never repairs. Repair is a decision, and a
//! silent auto-repair would just be a new way to hide the same class of bug.

use actix_web::{web, HttpRequest, HttpResponse};
use serde::Serialize;
use serde_json::json;

use crate::AppState;

#[derive(Serialize, sqlx::FromRow)]
struct FrozenPlayer {
    wallet_address: String,
    rank: String,
    xp: i32,
    wins: i32,
    /// Wins we can prove from the battle ledger. Divergence from `wins` means the
    /// player row stopped being written while fights kept landing.
    ledger_wins: i64,
    minutes_behind: f64,
}

#[derive(Serialize, sqlx::FromRow)]
struct StuckPayout {
    kind: String,
    wallet_address: String,
    reference: String,
    amount: i64,
    status: String,
    minutes_old: f64,
}

/// How long a payout may sit unsettled before it counts as stuck. The reconcile sweep
/// is the only thing that retries these, and GitHub's scheduler drifts, so this is set
/// well past the nominal 15-minute cadence to report real neglect rather than normal lag.
const STUCK_PAYOUT_MINUTES: f64 = 90.0;

/// `POST /health/consistency` — read-only self-audit. Shares the decay cron's secret.
pub async fn run_consistency_check(state: web::Data<AppState>, req: HttpRequest) -> HttpResponse {
    let expected = std::env::var("DECAY_CRON_SECRET").unwrap_or_default();
    let provided = req
        .headers()
        .get("x-cron-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if expected.is_empty() || provided != expected {
        return HttpResponse::Unauthorized().finish();
    }

    // 1. FROZEN PLAYER ROWS. Battles are recorded by a different statement than the one
    //    that persists xp/wins/rank, so when that save fails the two drift apart. Both
    //    sides of every battle are counted, since PvP awards the opponent too.
    let frozen = sqlx::query_as::<_, FrozenPlayer>(
        "WITH per_player AS (
             SELECT challenger_wallet AS w, created_at,
                    (winner_wallet = challenger_wallet) AS won
             FROM battles
             UNION ALL
             SELECT opponent_wallet, created_at, (winner_wallet = opponent_wallet)
             FROM battles WHERE opponent_wallet <> 'bot'
         ), agg AS (
             SELECT w, max(created_at) AS last_battle,
                    count(*) FILTER (WHERE won) AS ledger_wins
             FROM per_player GROUP BY w
         )
         SELECT p.wallet_address, p.rank, p.xp, p.wins,
                a.ledger_wins,
                (EXTRACT(EPOCH FROM (a.last_battle - p.last_active)) / 60)::float8 AS minutes_behind
         FROM players p
         JOIN agg a ON a.w = p.wallet_address
         WHERE a.last_battle > p.last_active + interval '2 minutes'
            OR p.wins <> a.ledger_wins
         ORDER BY a.last_battle DESC
         LIMIT 50",
    )
    .fetch_all(&state.db)
    .await;

    // 2. MONEY OWED BUT NOT SETTLED. A payout row is written before its on-chain
    //    transfer confirms; the reconcile sweep is the only retry. Anything still
    //    unsettled well past that cadence means the retry is not running.
    let stuck = sqlx::query_as::<_, StuckPayout>(
        "SELECT 'first_clear' AS kind, wallet_address, level::text AS reference,
                amount, status,
                (EXTRACT(EPOCH FROM (now() - created_at)) / 60)::float8 AS minutes_old
         FROM first_clear_bounties
         WHERE status <> 'paid' AND created_at < now() - ($1 || ' minutes')::interval
         UNION ALL
         SELECT 'rank_up', wallet_address, rank, amount, status,
                (EXTRACT(EPOCH FROM (now() - created_at)) / 60)::float8
         FROM rank_up_rewards
         WHERE status <> 'paid' AND created_at < now() - ($1 || ' minutes')::interval
         ORDER BY minutes_old DESC
         LIMIT 50",
    )
    .bind(STUCK_PAYOUT_MINUTES.to_string())
    .fetch_all(&state.db)
    .await;

    // A query that itself errors is a finding, not a reason to report all-clear.
    let (frozen, frozen_err) = match frozen {
        Ok(rows) => (rows, None),
        Err(e) => (vec![], Some(e.to_string())),
    };
    let (stuck, stuck_err) = match stuck {
        Ok(rows) => (rows, None),
        Err(e) => (vec![], Some(e.to_string())),
    };

    let healthy =
        frozen.is_empty() && stuck.is_empty() && frozen_err.is_none() && stuck_err.is_none();

    if !healthy {
        tracing::error!(
            "CONSISTENCY CHECK FAILED: {} frozen player row(s), {} stuck payout(s){}{}",
            frozen.len(),
            stuck.len(),
            frozen_err.as_ref().map(|e| format!(" | frozen query error: {}", e)).unwrap_or_default(),
            stuck_err.as_ref().map(|e| format!(" | payout query error: {}", e)).unwrap_or_default(),
        );
    }

    HttpResponse::Ok().json(json!({
        "healthy": healthy,
        "checked_at": chrono::Utc::now(),
        "frozen_players": frozen,
        "frozen_query_error": frozen_err,
        "stuck_payouts": stuck,
        "stuck_payout_query_error": stuck_err,
        "stuck_after_minutes": STUCK_PAYOUT_MINUTES,
    }))
}
