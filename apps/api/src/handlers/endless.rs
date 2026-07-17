use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{Datelike, Utc};
use ethers::types::Address;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::AppState;
use crate::services::battle::EndlessSession;
use crate::utils::{is_valid_wallet, normalize_wallet};

/// Current ISO year-week, e.g. "2026-W26" — the seasonal partition key.
fn current_week_key() -> String {
    let iso = Utc::now().iso_week();
    format!("{}-W{:02}", iso.year(), iso.week())
}

// ── Endless payout tuning (all env-overridable so we can retune without a deploy) ──

/// A run session lives at most this long; abandoned ones are swept on the next /start.
const ENDLESS_TTL_SECS: u64 = 3600;
/// Refereed XP per wave cleared — feeds ranks/prestige exactly like a real fight.
const ENDLESS_WAVE_XP: i32 = 50;

/// Minimum real seconds a wave must take. Reaching wave N can't happen before
/// N × this many seconds since the run started — the anti-script / anti-console-lie
/// floor. A genuine wave takes far longer; this only catches machine-speed spam.
fn min_secs_per_wave() -> f64 {
    std::env::var("ENDLESS_MIN_SECS_PER_WAVE").ok().and_then(|v| v.parse().ok()).unwrap_or(6.0)
}
/// Optional per-player, per-week G$ ceiling. 0 (default) = NO CAP. A config knob so a
/// cap can be switched on later without a code change (see the Endless spec).
fn weekly_cap_g() -> u64 {
    std::env::var("ENDLESS_WEEKLY_CAP_G").ok().and_then(|v| v.parse().ok()).unwrap_or(0)
}
/// Warn in the logs once the reward pool drops below this, so it gets topped up before
/// payouts start failing (the no-cap safety net).
fn pool_warn_g() -> u64 {
    std::env::var("ENDLESS_POOL_WARN_G").ok().and_then(|v| v.parse().ok()).unwrap_or(10_000)
}

/// G$ paid for clearing `wave` (1-based). Banded: 500 × ceil(wave/4). Waves 1–4 pay
/// 500 each, 5–8 pay 1,000, 9–12 pay 1,500 … deeper always pays more.
fn wave_reward_g(wave: i32) -> u64 {
    let band = ((wave + 3) / 4).max(1) as u64;
    500 * band
}

#[derive(Deserialize)]
pub struct SubmitScoreRequest {
    pub wallet: String,
    pub score: i32,
}

/// Record a finished Endless run (waves survived). Rate-limited; the score is the
/// client's reported wave count — low-stakes (it only affects the leaderboard, not
/// G$), so it follows the same "client reports, server guards" model as PvE fights.
pub async fn submit_score(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<SubmitScoreRequest>,
) -> HttpResponse {
    let ip = req.connection_info().realip_remote_addr().unwrap_or("unknown").to_string();
    if !state.battle_limiter.check(&ip) {
        return HttpResponse::TooManyRequests().json(json!({"error": "Too many submissions. Slow down."}));
    }
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    if body.score < 0 || body.score > 10_000 {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid score"}));
    }

    let wallet = body.wallet.to_lowercase();
    let week = current_week_key();

    let res = sqlx::query(
        "INSERT INTO endless_scores (wallet_address, score, week_key, created_at)
         VALUES ($1, $2, $3, now())",
    )
    .bind(&wallet)
    .bind(body.score)
    .bind(&week)
    .execute(&state.db)
    .await;

    match res {
        Ok(_) => HttpResponse::Ok().json(json!({"ok": true, "week": week})),
        Err(e) => {
            tracing::error!("endless score insert failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Failed to record score"}))
        }
    }
}

#[derive(Serialize, FromRow)]
pub struct LeaderRow {
    pub wallet_address: String,
    pub username: Option<String>,
    pub best: i32,
}

#[derive(Deserialize)]
pub struct LeaderQuery {
    pub scope: Option<String>, // "weekly" → current ISO week; anything else → all-time
    pub limit: Option<i64>,
}

/// Top Endless scores. `?scope=weekly` restricts to the current ISO week (the
/// seasonal/tournament board); otherwise it's all-time. Best score per wallet.
pub async fn get_leaderboard(
    state: web::Data<AppState>,
    query: web::Query<LeaderQuery>,
) -> HttpResponse {
    let weekly = query.scope.as_deref() == Some("weekly");
    let limit = query.limit.unwrap_or(25).clamp(1, 100);

    let rows = if weekly {
        sqlx::query_as::<_, LeaderRow>(
            "SELECT e.wallet_address, p.username, COALESCE(MAX(e.score), 0) AS best
             FROM endless_scores e
             LEFT JOIN players p ON p.wallet_address = e.wallet_address
             WHERE e.week_key = $1
             GROUP BY e.wallet_address, p.username
             ORDER BY best DESC
             LIMIT $2",
        )
        .bind(current_week_key())
        .bind(limit)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, LeaderRow>(
            "SELECT e.wallet_address, p.username, COALESCE(MAX(e.score), 0) AS best
             FROM endless_scores e
             LEFT JOIN players p ON p.wallet_address = e.wallet_address
             GROUP BY e.wallet_address, p.username
             ORDER BY best DESC
             LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await
    };

    match rows {
        Ok(r) => HttpResponse::Ok().json(json!({ "scope": if weekly { "weekly" } else { "all" }, "entries": r })),
        Err(e) => {
            tracing::error!("endless leaderboard query failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Failed to load leaderboard"}))
        }
    }
}

// ── Server-authoritative Endless runs (the money path) ────────────────────────────
//
// Endless pays real G$ per wave, so the server must OWN the wave count. The client
// only ever says "I cleared the next wave"; it can't assert a number, skip ahead, or
// (thanks to the min-time-per-wave floor) clear waves at machine speed. This is the
// same trust model as Campaign fight-sessions, applied to survival.

#[derive(Deserialize)]
pub struct StartEndlessRequest {
    pub wallet: String,
}

/// Open a server-authoritative Endless run and return its session id. The client hands
/// this back on every wave-clear; it is the only thing that can earn wave G$.
pub async fn start_endless(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<StartEndlessRequest>,
) -> HttpResponse {
    let ip = req.connection_info().realip_remote_addr().unwrap_or("unknown").to_string();
    if !state.battle_limiter.check(&ip) {
        return HttpResponse::TooManyRequests().json(json!({"error": "Too many runs. Slow down, warrior."}));
    }
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&body.wallet);

    // Sweep abandoned sessions opportunistically — no background task needed.
    state.endless_sessions.retain(|_, s| s.created_at.elapsed() < Duration::from_secs(ENDLESS_TTL_SECS));

    let session_id = Uuid::new_v4();
    state.endless_sessions.insert(session_id, EndlessSession {
        wallet,
        wave: 0,
        created_at: Instant::now(),
    });
    HttpResponse::Ok().json(json!({ "session_id": session_id }))
}

#[derive(Deserialize)]
pub struct EndlessWaveRequest {
    pub session_id: Uuid,
}

/// Credit ONE cleared wave. The server increments its own counter (so the wave number
/// is authoritative), enforces the min-time-per-wave floor, pays the banded G$ once
/// (idempotent, async, reconcilable), and awards refereed XP that feeds ranks/prestige.
pub async fn endless_wave(
    state: web::Data<AppState>,
    body: web::Json<EndlessWaveRequest>,
) -> HttpResponse {
    // Advance the SERVER's wave counter under the session lock; validate timing here.
    let (wallet, wave) = {
        let Some(mut session) = state.endless_sessions.get_mut(&body.session_id) else {
            return HttpResponse::NotFound().json(json!({"error": "No active run — start a new one", "expired": true}));
        };
        if session.created_at.elapsed() >= Duration::from_secs(ENDLESS_TTL_SECS) {
            return HttpResponse::NotFound().json(json!({"error": "Run expired", "expired": true}));
        }
        let next_wave = session.wave + 1;
        // Anti-script floor: wave N cannot be reported before N × min_secs since start.
        let required = next_wave as f64 * min_secs_per_wave();
        if session.created_at.elapsed().as_secs_f64() < required {
            return HttpResponse::TooManyRequests().json(json!({"error": "Too fast", "too_fast": true}));
        }
        session.wave = next_wave;
        (session.wallet.clone(), next_wave)
    };

    let week = current_week_key();
    let mut amount = wave_reward_g(wave);

    // Optional weekly cap (0 = off). Never lowers below zero; the run still continues
    // for score/XP even once a capped player stops earning G$.
    let cap = weekly_cap_g();
    if cap > 0 {
        let paid_this_week: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount), 0)::bigint FROM endless_rewards
             WHERE wallet_address = $1 AND week_key = $2 AND status <> 'failed'",
        )
        .bind(&wallet).bind(&week)
        .fetch_optional(&state.db).await.ok().flatten().unwrap_or(0);
        let remaining = (cap as i64 - paid_this_week).max(0) as u64;
        amount = amount.min(remaining);
    }

    // Claim the once-per-(session,wave) payout slot idempotently.
    let claimed = amount > 0 && sqlx::query(
        "INSERT INTO endless_rewards (session_id, wave, wallet_address, amount, week_key)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id, wave) DO NOTHING",
    )
    .bind(body.session_id).bind(wave).bind(&wallet).bind(amount as i64).bind(&week)
    .execute(&state.db).await
    .map(|r| r.rows_affected() == 1)
    .unwrap_or(false);

    if claimed {
        if let (Some(chain), Ok(addr)) = (state.chain.as_ref().cloned(), wallet.parse::<Address>()) {
            let db = state.db.clone();
            let (w, sid) = (wallet.clone(), body.session_id);
            tokio::spawn(async move {
                settle_endless_reward(&db, &chain, &w, sid, wave, addr, amount).await;
            });
        }
    }

    // Refereed XP for the wave — feeds ranks/prestige (the volume flywheel), but is NOT
    // counted as a win on the W/L record (count_result = false).
    let award = crate::handlers::battles::award_player(&state, &wallet, true, ENDLESS_WAVE_XP, 1, true, false).await;

    let (new_xp, ranked_up, new_rank, prestiged, prestige_level) = match &award {
        Ok(a) => (a.new_xp, a.ranked_up, a.new_rank, a.prestiged, a.prestige_level),
        Err(_) => (0, false, None, false, 0),
    };

    HttpResponse::Ok().json(json!({
        "wave":           wave,
        "g_awarded":      amount,          // 0 if the weekly cap is in effect and hit
        "xp_awarded":     ENDLESS_WAVE_XP,
        "new_xp":         new_xp,
        "ranked_up":      ranked_up,
        "new_rank":       new_rank,
        "prestiged":      prestiged,
        "prestige_level": prestige_level,
    }))
}

#[derive(Deserialize)]
pub struct EndEndlessRequest {
    pub session_id: Uuid,
}

/// End a run: write the leaderboard score from the SERVER's wave count (never the
/// client's) and drop the session.
pub async fn end_endless(
    state: web::Data<AppState>,
    body: web::Json<EndEndlessRequest>,
) -> HttpResponse {
    let Some((_, session)) = state.endless_sessions.remove(&body.session_id) else {
        return HttpResponse::Ok().json(json!({"ok": true, "score": 0, "note": "no session"}));
    };
    let week = current_week_key();
    let _ = sqlx::query(
        "INSERT INTO endless_scores (wallet_address, score, week_key, created_at)
         VALUES ($1, $2, $3, now())",
    )
    .bind(&session.wallet).bind(session.wave).bind(&week)
    .execute(&state.db).await;

    HttpResponse::Ok().json(json!({ "ok": true, "score": session.wave, "week": week }))
}

/// Settle one Endless wave payout on-chain and reconcile the DB row + ledger + lifetime.
/// Mirrors settle_rank_up_reward: the on-chain `ref` (keyed per wallet+session+wave)
/// makes it idempotent, a row whose payout landed but whose DB write was lost is
/// reconciled without a doomed retry, and the ledger/lifetime credit is gated on the
/// row actually transitioning to 'paid' so a live+sweep race can't double-count.
pub async fn settle_endless_reward(
    db: &sqlx::PgPool,
    chain: &crate::services::chain::ChainWriter,
    wallet: &str,
    session_id: Uuid,
    wave: i32,
    addr: Address,
    amount: u64,
) -> &'static str {
    let reference = ethers::utils::keccak256(
        format!("endless:{}:{}:{}", wallet, session_id, wave).as_bytes(),
    );
    let already_paid = chain.endless_ref_used(reference).await.unwrap_or(false);
    let result = if already_paid { Ok(true) } else { chain.distribute_endless_reward(addr, amount, reference).await };

    match result {
        Ok(true) => {
            let credited = sqlx::query(
                "UPDATE endless_rewards SET status = 'paid'
                 WHERE session_id = $1 AND wave = $2 AND status <> 'paid'",
            )
            .bind(session_id).bind(wave).execute(db).await
            .map(|r| r.rows_affected() == 1)
            .unwrap_or(false);

            if credited {
                let _ = sqlx::query("UPDATE players SET g_earned_lifetime = g_earned_lifetime + $1 WHERE wallet_address = $2")
                    .bind(amount as i64).bind(wallet).execute(db).await;
                crate::handlers::ledger::insert_ledger_entry(
                    db, wallet, "battle_reward", rust_decimal::Decimal::from(amount), None, None,
                ).await;
                tracing::info!("endless reward paid: {} wave{} +{} G${}",
                    wallet, wave, amount, if already_paid { " (reconciled)" } else { "" });
                warn_if_pool_low(chain).await;
            }
            "paid"
        }
        Ok(false) => {
            tracing::warn!("Reward pool not configured — endless reward for {} wave{} not paid", wallet, wave);
            let _ = sqlx::query("UPDATE endless_rewards SET status = 'failed' WHERE session_id = $1 AND wave = $2")
                .bind(session_id).bind(wave).execute(db).await;
            "unconfigured"
        }
        Err(e) => {
            tracing::error!("endless reward on-chain failed for {} wave{}: {}", wallet, wave, e);
            let _ = sqlx::query("UPDATE endless_rewards SET status = 'failed' WHERE session_id = $1 AND wave = $2")
                .bind(session_id).bind(wave).execute(db).await;
            "failed"
        }
    }
}

/// The no-cap safety net: log a WARN once the reward pool drops below the threshold, so
/// it gets topped up before payouts start failing on an empty pool.
async fn warn_if_pool_low(chain: &crate::services::chain::ChainWriter) {
    let Some(pool) = chain.endless_pool_address() else { return };
    if let Ok(bal) = chain.g_balance(pool).await {
        let whole = (bal / ethers::types::U256::exp10(18)).as_u128() as u64;
        let warn = pool_warn_g();
        if whole < warn {
            tracing::warn!("⚠️ ValorRewardPool low: {} G$ (< {} warn threshold) — TOP UP or Endless/rank payouts will start failing", whole, warn);
        }
    }
}

/// Re-attempt every unsettled Endless reward (failed, or pending abandoned >5 min).
/// Shares the reconcile cron with the bounty/rank sweeps. Idempotent via the on-chain
/// ref guard. Returns (attempted, reconciled).
pub async fn sweep_endless_rewards(
    db: &sqlx::PgPool,
    chain: &crate::services::chain::ChainWriter,
) -> (u32, u32) {
    let rows: Vec<(Uuid, i32, String, i64)> = sqlx::query_as(
        "SELECT session_id, wave, wallet_address, amount
         FROM endless_rewards
         WHERE status = 'failed'
            OR (status = 'pending' AND created_at < now() - interval '5 minutes')
         ORDER BY created_at ASC
         LIMIT 25",
    )
    .fetch_all(db).await.unwrap_or_default();

    let attempted = rows.len() as u32;
    let mut reconciled = 0u32;
    for (sid, wave, wallet, amount) in rows {
        let Ok(addr) = wallet.parse::<Address>() else { continue };
        if settle_endless_reward(db, chain, &wallet, sid, wave, addr, amount.max(0) as u64).await == "paid" {
            reconciled += 1;
        }
    }
    (attempted, reconciled)
}
