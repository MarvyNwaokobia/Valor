//! Per-player weekly G$ ceiling, shared by every grindable earn surface.
//!
//! WHY THIS EXISTS. Endless pays 100 × wave, repeatable for ever, which is the only
//! unbounded way to earn in the game — Campaign bounties pay once per level on first
//! clear, and rank-up bonuses pay once per rank. So one player with time can take an
//! arbitrary share of a finite pool. Observed: a median week is 750 G$ and the record
//! is 60,600.
//!
//! WHAT COUNTS. Only *grindable* earnings: Endless waves, Campaign first clears, and
//! rank-up bonuses. Season prizes and duel payouts are deliberately exempt — a prize
//! is budgeted, competitive and bounded by us already, and counting a 50,000 G$
//! season prize against the same allowance would consume a player's whole week for
//! winning something we chose to give them.
//!
//! NOT A HARD WALL. Past the cap, earnings continue at a reduced rate rather than
//! stopping. A hard stop means a player who caps on Tuesday has no reason to open the
//! app until Monday, which costs exactly the daily-active number the cap is meant to
//! protect the pool for. At 25%, earning another 25,000 past the cap takes 100,000 of
//! raw rewards — a real brake without a dead end.
//!
//! THE CAP IS NOT A SOLVENCY TOOL. It bounds one player, not the pool: at 50,000 a
//! handful of players can still empty a 200,000 G$ pool in a week. Keeping the pool
//! funded is a separate job (see `pool_warn_g` in the endless handler).

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Datelike, TimeZone, Utc, Weekday};
use sqlx::PgPool;

/// Per-player G$ ceiling for one week. `WEEKLY_EARN_CAP_G=0` disables capping.
pub fn weekly_cap_g() -> u64 {
    std::env::var("WEEKLY_EARN_CAP_G").ok().and_then(|v| v.parse().ok()).unwrap_or(50_000)
}

/// Share of a reward still paid once the cap is reached. 0.0 = hard stop.
pub fn over_cap_rate() -> f64 {
    std::env::var("WEEKLY_EARN_OVER_CAP_RATE").ok().and_then(|v| v.parse().ok()).unwrap_or(0.25)
}

/// Monday 00:00 UTC of the current ISO week — the same boundary `current_week_key()`
/// labels, expressed as an instant so the three reward tables can be summed on it.
pub fn week_start() -> DateTime<Utc> {
    let today = Utc::now().date_naive();
    let monday = today.week(Weekday::Mon).first_day();
    Utc.from_utc_datetime(&monday.and_hms_opt(0, 0, 0).expect("midnight is a valid time"))
}

/// Trim `proposed` to what a player who has already earned `earned` this week may
/// still receive. Pure, so the policy is testable without a database.
///
/// Below the cap the reward is paid in full; the portion that would cross the cap is
/// paid at `rate`. A reward straddling the boundary is split, so the exact size of an
/// individual payout never changes the total a player can reach.
pub fn apply_cap(earned: u64, proposed: u64, cap: u64, rate: f64) -> u64 {
    if cap == 0 { return proposed; } // capping disabled
    let rate = rate.clamp(0.0, 1.0);
    let headroom = cap.saturating_sub(earned);
    if proposed <= headroom { return proposed; }
    let over = proposed - headroom;
    headroom + (over as f64 * rate).floor() as u64
}

/// G$ this wallet has already been granted from grindable sources this week.
///
/// Reads the reward tables rather than `g_ledger` on purpose: these rows are written
/// synchronously when the reward is claimed, while the ledger entry lands only after
/// the on-chain transfer settles. Summing the ledger would let a burst of fast waves
/// all read a stale total and every one of them clear the cap.
///
/// `failed` rows are excluded (nothing was delivered), `voided` too. Anything still
/// `pending` counts: it is money we have committed to send.
pub async fn earned_this_week(db: &PgPool, wallet: &str) -> u64 {
    let since = week_start();
    let total: Option<i64> = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount), 0)::bigint FROM (
             SELECT amount FROM endless_rewards
              WHERE wallet_address = $1 AND created_at >= $2 AND status <> 'failed'
             UNION ALL
             SELECT amount FROM first_clear_bounties
              WHERE wallet_address = $1 AND created_at >= $2 AND status NOT IN ('failed', 'voided')
             UNION ALL
             SELECT amount FROM rank_up_rewards
              WHERE wallet_address = $1 AND created_at >= $2 AND status NOT IN ('failed', 'voided')
         ) t",
    )
    .bind(wallet)
    .bind(since)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    total.unwrap_or(0).max(0) as u64
}

// ── Pool floor ────────────────────────────────────────────────────────────────
//
// The weekly cap bounds ONE player. It does not bound the pool: at 50,000 a
// handful of capped players still empty a 200,000 G$ balance inside a week, and
// the failure mode is ugly — transfers start reverting mid-session, so players
// see rewards that silently never arrive rather than a smaller reward.
//
// So below a floor, grindable payouts taper. Prizes and duel payouts are
// untouched, same as the cap: they are budgeted, and a season that cannot pay
// its winners is worse than a slow drip of bounties.

/// Reward-pool balance under which grindable payouts taper. 0 disables.
fn pool_floor_g() -> u64 {
    std::env::var("REWARD_POOL_FLOOR_G").ok().and_then(|v| v.parse().ok()).unwrap_or(50_000)
}

/// Share of a reward still paid while the pool is under the floor.
fn pool_floor_rate() -> f64 {
    std::env::var("REWARD_POOL_FLOOR_RATE").ok().and_then(|v| v.parse().ok()).unwrap_or(0.25)
}

/// How long a pool-balance reading is reused. An RPC round trip per reward would
/// put a network call in the path of every wave cleared; the balance only has to
/// be fresh enough to catch the floor within a minute of crossing it.
const POOL_BALANCE_TTL: Duration = Duration::from_secs(60);

static POOL_BALANCE: OnceLock<Mutex<Option<(Instant, u64)>>> = OnceLock::new();

/// Whole G$ in the main reward pool, cached. `None` when there is no chain
/// configured or the read failed — callers treat that as "do not taper", because
/// refusing to pay on a failed balance read would turn an RPC blip into a silent
/// pay cut.
async fn pool_balance_g(chain: &crate::services::chain::ChainWriter) -> Option<u64> {
    let cell = POOL_BALANCE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cell.lock() {
        if let Some((at, bal)) = *guard {
            if at.elapsed() < POOL_BALANCE_TTL { return Some(bal); }
        }
    }
    let addr = chain.reward_pool_address()?;
    let raw = chain.g_balance(addr).await.ok()?;
    let whole = (raw / ethers::types::U256::exp10(18)).as_u64();
    if let Ok(mut guard) = cell.lock() {
        *guard = Some((Instant::now(), whole));
    }
    Some(whole)
}

/// Cap `proposed` against this wallet's weekly allowance, then against the pool.
/// Returns the amount actually payable.
pub async fn cap_reward(state: &crate::AppState, wallet: &str, proposed: u64) -> u64 {
    if proposed == 0 { return 0; }
    let mut allowed = proposed;

    let cap = weekly_cap_g();
    if cap > 0 {
        let earned = earned_this_week(&state.db, wallet).await;
        allowed = apply_cap(earned, allowed, cap, over_cap_rate());
        if allowed < proposed {
            tracing::info!(
                "weekly cap: {} earned {} of {} this week — reward trimmed {} -> {}",
                wallet, earned, cap, proposed, allowed,
            );
        }
    }

    let floor = pool_floor_g();
    if floor > 0 && allowed > 0 {
        if let Some(chain) = state.chain.as_ref() {
            if let Some(balance) = pool_balance_g(chain).await {
                if balance < floor {
                    let tapered = (allowed as f64 * pool_floor_rate().clamp(0.0, 1.0)).floor() as u64;
                    tracing::warn!(
                        "REWARD POOL LOW: {} G$ is under the {} G$ floor — payouts tapered \
                         ({} -> {} for {}). Top the pool up.",
                        balance, floor, allowed, tapered, wallet,
                    );
                    allowed = tapered;
                }
            }
        }
    }

    allowed
}

/// What the player is shown: how much of this week's allowance is spent, and what
/// happens next. Diminishing returns the player cannot see read as a payout bug,
/// so this exists specifically to be rendered, not just to be queryable.
pub async fn status_for(db: &PgPool, wallet: &str) -> serde_json::Value {
    let cap = weekly_cap_g();
    let earned = earned_this_week(db, wallet).await;
    let resets = week_start() + chrono::Duration::days(7);
    serde_json::json!({
        "earned_this_week_g": earned,
        "cap_g": cap,
        "remaining_g": cap.saturating_sub(earned),
        "over_cap": cap > 0 && earned >= cap,
        // Percentage of full rate earned past the cap, for the explanatory line.
        "over_cap_rate": over_cap_rate(),
        "resets_at": resets.to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;

    const CAP: u64 = 50_000;
    const RATE: f64 = 0.25;

    #[test]
    fn under_the_cap_pays_in_full() {
        assert_eq!(apply_cap(0, 1_000, CAP, RATE), 1_000);
        assert_eq!(apply_cap(40_000, 5_000, CAP, RATE), 5_000);
    }

    #[test]
    fn exactly_reaching_the_cap_still_pays_in_full() {
        assert_eq!(apply_cap(45_000, 5_000, CAP, RATE), 5_000);
    }

    #[test]
    fn a_reward_straddling_the_cap_is_split() {
        // 2,000 of headroom left, then 8,000 over at 25% = 2,000.
        assert_eq!(apply_cap(48_000, 10_000, CAP, RATE), 4_000);
    }

    #[test]
    fn past_the_cap_pays_the_reduced_rate() {
        assert_eq!(apply_cap(50_000, 10_000, CAP, RATE), 2_500);
        assert_eq!(apply_cap(90_000, 4_000, CAP, RATE), 1_000);
    }

    #[test]
    fn splitting_a_reward_cannot_beat_taking_it_whole() {
        // The straddle rule exists so payout SIZE is not a lever. Ten 1,000s must
        // reach the same total as one 10,000 from the same starting point.
        let whole = apply_cap(48_000, 10_000, CAP, RATE);
        let mut earned = 48_000;
        let mut got = 0;
        for _ in 0..10 {
            let paid = apply_cap(earned, 1_000, CAP, RATE);
            got += paid;
            earned += 1_000; // the grant is recorded at full value
        }
        assert_eq!(whole, got);
    }

    #[test]
    fn zero_rate_is_a_hard_stop() {
        assert_eq!(apply_cap(50_000, 10_000, CAP, 0.0), 0);
        assert_eq!(apply_cap(48_000, 10_000, CAP, 0.0), 2_000);
    }

    #[test]
    fn zero_cap_disables_capping() {
        assert_eq!(apply_cap(999_999, 10_000, 0, RATE), 10_000);
    }

    #[test]
    fn a_rate_above_one_cannot_mint_extra() {
        assert_eq!(apply_cap(50_000, 10_000, CAP, 5.0), 10_000);
    }

    #[test]
    fn week_starts_on_a_monday_midnight() {
        let w = week_start();
        assert_eq!(w.weekday(), Weekday::Mon);
        assert_eq!((w.hour(), w.minute(), w.second()), (0, 0, 0));
        assert!(w <= Utc::now());
    }
}
