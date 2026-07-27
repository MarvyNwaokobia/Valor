//! B4 — staked async score-duels.
//!
//! Two players stake the same G$, both play the SAME seeded run separately, and the
//! higher server-validated score takes the pot minus a house cut. There is no live
//! netcode here on purpose: with no shared real-time simulation there is nothing to
//! desync, and the only thing a client reports is a score the server range-checks
//! against elapsed time it measured itself.
//!
//! Money reuses the proven rails rather than a new contract:
//!   stake   player -> RewardPool  via `spend_rearm`      (the B1 re-arm allowance rail)
//!   payout  RewardPool -> winner  via `distribute_reward` (idempotent by reference)
//! Stakes fund the payout, so a duel emits nothing new and the retained cut is a sink.

use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use ethers::types::{Address, U256};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::AppState;

/// Percent of the pot the house keeps. The sink that makes duels net-deflationary:
/// 2 stakes come in, 1.8 go out, 0.2 stays in the RewardPool.
const HOUSE_CUT_PERCENT: u64 = 10;

/// Stake bounds, in whole G$. The floor keeps dust duels from spamming the chain
/// (every duel costs two escrow txs + one payout tx in CELO gas); the ceiling
/// bounds how much a single bad run can cost a player while this is new.
const MIN_STAKE_G: i64 = 100;
const MAX_STAKE_G: i64 = 50_000;

/// Anti-cheat anchor, mirroring the Gauntlet's: a score cannot exceed what the
/// server-measured elapsed time can physically support. A client never supplies
/// its own duration — we measure from the token we issued.
const MAX_SCORE_PER_SEC: f64 = 400.0;
const MIN_RUN_SECS: f64 = 10.0;
/// A token older than this is stale; the run is abandoned rather than scored.
const MAX_RUN_SECS: f64 = 2.0 * 3600.0;

fn g_wei(whole: u64) -> U256 {
    U256::from(whole) * U256::exp10(18)
}

/// What the winner receives from a pot of two `stake` deposits.
fn winner_payout(stake_g: i64) -> u64 {
    let pot = (stake_g as u64).saturating_mul(2);
    pot.saturating_mul(100 - HOUSE_CUT_PERCENT) / 100
}

/// Pure validation of a submitted duel score, extracted so the anti-cheat rules are
/// unit-testable without a database or a chain.
fn validate_score(score: i32, elapsed_secs: f64) -> Result<(), &'static str> {
    if score < 0 {
        return Err("score out of range");
    }
    if elapsed_secs > MAX_RUN_SECS {
        return Err("run too long — token stale");
    }
    // Sub-second submits are the cheapest possible forgery; require a real run.
    if elapsed_secs < MIN_RUN_SECS {
        return Err("run too short to be real");
    }
    if f64::from(score) > elapsed_secs * MAX_SCORE_PER_SEC {
        return Err("score too high for elapsed time");
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct DuelRow {
    id: Uuid,
    challenger_wallet: String,
    opponent_wallet: Option<String>,
    stake_g: i64,
    seed: i64,
    challenger_run_token: Option<String>,
    challenger_started_at: Option<DateTime<Utc>>,
    challenger_score: Option<i32>,
    opponent_run_token: Option<String>,
    opponent_started_at: Option<DateTime<Utc>>,
    opponent_score: Option<i32>,
    status: String,
    winner_wallet: Option<String>,
}

/// Move `stake` from the player into the RewardPool. Returns the tx hash.
///
/// Gates on the LIVE on-chain allowance and balance first: an insufficient
/// allowance means the player's session cap is spent and the client must re-arm,
/// which is a different remedy from "you're broke" and gets its own message.
async fn escrow_stake(
    state: &AppState,
    wallet: &str,
    stake_g: i64,
) -> Result<String, HttpResponse> {
    let chain = state.chain.as_ref().ok_or_else(|| {
        HttpResponse::ServiceUnavailable().json(json!({"error": "Chain relay not available"}))
    })?;
    let owner: Address = wallet.parse().map_err(|_| {
        HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}))
    })?;
    let pool = chain.reward_pool_address().ok_or_else(|| {
        HttpResponse::ServiceUnavailable().json(json!({"error": "Duel escrow not configured"}))
    })?;

    let need = g_wei(stake_g as u64);
    let allowance = chain.g_allowance(owner).await.unwrap_or_else(|_| U256::zero());
    if allowance < need {
        return Err(HttpResponse::PaymentRequired().json(json!({
            "error": "Session allowance used up — arm more G$ to stake",
            "need_arm": true, "stake_g": stake_g,
        })));
    }
    let balance = chain.g_balance(owner).await.unwrap_or_else(|_| U256::zero());
    if balance < need {
        return Err(HttpResponse::PaymentRequired().json(json!({
            "error": "Not enough G$ for this stake", "stake_g": stake_g,
        })));
    }

    match chain.spend_rearm(owner, pool, need).await {
        Ok(hash) => {
            let tx_hash = format!("{:?}", hash);
            crate::handlers::ledger::insert_ledger_entry(
                &state.db, wallet, "duel_stake",
                rust_decimal::Decimal::from(-stake_g), Some(&tx_hash), None,
            ).await;
            Ok(tx_hash)
        }
        Err(e) => {
            tracing::error!("duel stake escrow failed for {}: {}", wallet, e);
            Err(HttpResponse::BadGateway().json(json!({"error": "Stake transfer failed — nothing was charged"})))
        }
    }
}

/// Pay `amount_g` out of the RewardPool for `ref_key`, once. The on-chain reference
/// is the idempotency key: a replayed request finds the ref already used and pays
/// nothing, which is what makes a retried resolve safe.
async fn payout(state: &AppState, wallet: &str, amount_g: u64, ref_key: &str) -> Option<String> {
    let chain = state.chain.as_ref()?;
    let addr: Address = wallet.parse().ok()?;
    let reference = ethers::utils::keccak256(ref_key.as_bytes());

    if chain.reward_ref_used(reference).await.unwrap_or(false) {
        tracing::info!("duel payout {} already settled on-chain — skipping", ref_key);
        return None;
    }
    match chain.distribute_reward(addr, amount_g, reference).await {
        Ok(Some(tx)) => {
            crate::handlers::ledger::insert_ledger_entry(
                &state.db, wallet, "duel_payout",
                rust_decimal::Decimal::from(amount_g), Some(&tx), None,
            ).await;
            Some(tx)
        }
        Ok(None) => None,
        Err(e) => {
            tracing::error!("duel payout FAILED for {} ({}): {}", wallet, ref_key, e);
            None
        }
    }
}

// ── POST /duels ───────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct CreateRequest {
    pub wallet: String,
    pub stake_g: i64,
}

/// Open a duel: escrow the challenger's stake and issue their run token.
///
/// The seed is generated here and never accepted from the client — otherwise a
/// challenger could shop for a layout they had already practised, which would make
/// the whole "same run for both players" premise worthless.
pub async fn create_duel(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<CreateRequest>,
) -> HttpResponse {
    let ip = req.connection_info().realip_remote_addr().unwrap_or("unknown").to_string();
    if !state.battle_limiter.check(&ip) {
        return HttpResponse::TooManyRequests().json(json!({"error": "Too many duels. Slow down."}));
    }
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    if body.stake_g < MIN_STAKE_G || body.stake_g > MAX_STAKE_G {
        return HttpResponse::BadRequest().json(json!({
            "error": format!("Stake must be between {} and {} G$", MIN_STAKE_G, MAX_STAKE_G),
        }));
    }
    let wallet = normalize_wallet(&body.wallet);

    // Reject a second open duel BEFORE escrowing, so a duplicate request can never
    // charge a stake it then has nowhere to put (the unique index would reject the
    // insert and the G$ would already be gone).
    let open: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM duels WHERE challenger_wallet = $1 AND status = 'open'",
    )
    .bind(&wallet).fetch_optional(&state.db).await.unwrap_or(None);
    if open.is_some() {
        return HttpResponse::Conflict().json(json!({
            "error": "You already have an open duel — cancel it or wait for someone to accept",
        }));
    }

    let stake_tx = match escrow_stake(&state, &wallet, body.stake_g).await {
        Ok(tx) => tx,
        Err(resp) => return resp,
    };

    let id = Uuid::new_v4();
    let token = Uuid::new_v4().to_string();
    // Positive seed only: the client feeds it to a uint-based PRNG.
    let seed = (Uuid::new_v4().as_u128() as i64).abs();
    let now = Utc::now();

    let inserted = sqlx::query(
        "INSERT INTO duels (id, challenger_wallet, stake_g, seed,
                            challenger_run_token, challenger_started_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open')",
    )
    .bind(id).bind(&wallet).bind(body.stake_g).bind(seed)
    .bind(&token).bind(now)
    .execute(&state.db).await;

    if let Err(e) = inserted {
        // The stake is already on-chain. Refund rather than strand it.
        tracing::error!("duel insert failed after escrow for {}: {} — refunding", wallet, e);
        let refunded = payout(&state, &wallet, body.stake_g as u64, &format!("duel_refund:{}", stake_tx)).await;
        return HttpResponse::InternalServerError().json(json!({
            "error": "Could not open the duel — your stake was refunded",
            "refund_tx": refunded,
        }));
    }

    tracing::info!("duel {} opened by {} for {} G$", id, wallet, body.stake_g);
    HttpResponse::Ok().json(json!({
        "id": id, "seed": seed, "stake_g": body.stake_g,
        "run_token": token, "stake_tx": stake_tx,
        "winner_takes_g": winner_payout(body.stake_g),
    }))
}

// ── POST /duels/{id}/accept ───────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct AcceptRequest {
    pub wallet: String,
}

pub async fn accept_duel(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
    body: web::Json<AcceptRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&body.wallet);

    let duel: Option<DuelRow> = sqlx::query_as("SELECT * FROM duels WHERE id = $1")
        .bind(id).fetch_optional(&state.db).await.unwrap_or(None);
    let duel = match duel {
        Some(d) => d,
        None => return HttpResponse::NotFound().json(json!({"error": "Duel not found"})),
    };
    if duel.status != "open" {
        return HttpResponse::Conflict().json(json!({"error": "That duel is no longer open"}));
    }
    if duel.challenger_wallet == wallet {
        return HttpResponse::BadRequest().json(json!({"error": "You can't accept your own duel"}));
    }

    let stake_tx = match escrow_stake(&state, &wallet, duel.stake_g).await {
        Ok(tx) => tx,
        Err(resp) => return resp,
    };

    let token = Uuid::new_v4().to_string();
    let now = Utc::now();
    // Conditional on status = 'open' so two simultaneous accepts can't both win the
    // duel; the loser of the race is refunded rather than left staked into nothing.
    let claimed = sqlx::query(
        "UPDATE duels SET opponent_wallet = $1, opponent_run_token = $2,
                          opponent_started_at = $3, status = 'accepted', accepted_at = $3
         WHERE id = $4 AND status = 'open'",
    )
    .bind(&wallet).bind(&token).bind(now).bind(id)
    .execute(&state.db).await;

    let won_race = claimed.map(|r| r.rows_affected() == 1).unwrap_or(false);
    if !won_race {
        tracing::warn!("duel {} accept race lost by {} — refunding", id, wallet);
        let refunded = payout(&state, &wallet, duel.stake_g as u64, &format!("duel_refund:{}", stake_tx)).await;
        return HttpResponse::Conflict().json(json!({
            "error": "Someone accepted first — your stake was refunded",
            "refund_tx": refunded,
        }));
    }

    tracing::info!("duel {} accepted by {}", id, wallet);
    HttpResponse::Ok().json(json!({
        "id": id, "seed": duel.seed, "stake_g": duel.stake_g,
        "run_token": token, "stake_tx": stake_tx,
        "winner_takes_g": winner_payout(duel.stake_g),
    }))
}

// ── POST /duels/{id}/submit ───────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct SubmitRequest {
    pub wallet: String,
    pub run_token: String,
    pub score: i32,
}

/// Record one side's score and resolve the duel once both are in.
pub async fn submit_duel_score(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
    body: web::Json<SubmitRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&body.wallet);

    let duel: Option<DuelRow> = sqlx::query_as("SELECT * FROM duels WHERE id = $1")
        .bind(id).fetch_optional(&state.db).await.unwrap_or(None);
    let duel = match duel {
        Some(d) => d,
        None => return HttpResponse::NotFound().json(json!({"error": "Duel not found"})),
    };
    if duel.status == "resolved" || duel.status == "cancelled" {
        return HttpResponse::Conflict().json(json!({"error": "That duel is already finished"}));
    }

    // Which side is submitting, and does their token match? An unknown wallet or a
    // wrong/reused token is rejected outright — the token is the only proof the run
    // was started through us, and it carries the start time we measure against.
    let is_challenger = duel.challenger_wallet == wallet;
    let is_opponent = duel.opponent_wallet.as_deref() == Some(wallet.as_str());
    let (expected_token, started_at, already) = if is_challenger {
        (duel.challenger_run_token.clone(), duel.challenger_started_at, duel.challenger_score)
    } else if is_opponent {
        (duel.opponent_run_token.clone(), duel.opponent_started_at, duel.opponent_score)
    } else {
        return HttpResponse::Forbidden().json(json!({"error": "You are not in this duel"}));
    };
    if expected_token.as_deref() != Some(body.run_token.as_str()) {
        return HttpResponse::Forbidden().json(json!({"error": "Invalid run token"}));
    }
    if already.is_some() {
        return HttpResponse::Conflict().json(json!({"error": "You already submitted a score"}));
    }
    let started = match started_at {
        Some(t) => t,
        None => return HttpResponse::Conflict().json(json!({"error": "No open run for this duel"})),
    };

    let elapsed = (Utc::now() - started).num_milliseconds() as f64 / 1000.0;
    if let Err(reason) = validate_score(body.score, elapsed) {
        tracing::warn!("duel {} score rejected for {}: {} (score={}, {:.1}s)", id, wallet, reason, body.score, elapsed);
        return HttpResponse::BadRequest().json(json!({"error": reason}));
    }

    let col = if is_challenger { "challenger_score" } else { "opponent_score" };
    let stored = sqlx::query(&format!(
        "UPDATE duels SET {} = $1 WHERE id = $2 AND {} IS NULL", col, col
    ))
    .bind(body.score).bind(id)
    .execute(&state.db).await;
    if stored.map(|r| r.rows_affected()).unwrap_or(0) != 1 {
        return HttpResponse::Conflict().json(json!({"error": "You already submitted a score"}));
    }

    resolve_if_complete(&state, id).await
}

/// Resolve once both sides have scored. Safe to call repeatedly: the status guard
/// lets exactly one caller do the payout, and the on-chain reference makes even a
/// duplicated payout a no-op.
async fn resolve_if_complete(state: &AppState, id: Uuid) -> HttpResponse {
    let duel: Option<DuelRow> = sqlx::query_as("SELECT * FROM duels WHERE id = $1")
        .bind(id).fetch_optional(&state.db).await.unwrap_or(None);
    let duel = match duel {
        Some(d) => d,
        None => return HttpResponse::NotFound().json(json!({"error": "Duel not found"})),
    };

    let (cs, os) = match (duel.challenger_score, duel.opponent_score) {
        (Some(c), Some(o)) => (c, o),
        _ => {
            return HttpResponse::Ok().json(json!({
                "id": id, "status": duel.status, "resolved": false,
                "waiting_on_opponent": true,
            }))
        }
    };
    let opponent = match duel.opponent_wallet.clone() {
        Some(o) => o,
        None => return HttpResponse::Ok().json(json!({"id": id, "resolved": false})),
    };

    // Claim the right to pay out. Only the caller that flips 'accepted' -> 'resolved'
    // proceeds; a concurrent one falls through to reporting the result.
    let claimed = sqlx::query(
        "UPDATE duels SET status = 'resolved', resolved_at = now() WHERE id = $1 AND status = 'accepted'",
    )
    .bind(id).execute(&state.db).await;
    if claimed.map(|r| r.rows_affected()).unwrap_or(0) != 1 {
        return HttpResponse::Ok().json(json!({
            "id": id, "resolved": true, "challenger_score": cs, "opponent_score": os,
            "winner": duel.winner_wallet,
        }));
    }

    // A draw refunds both stakes and takes NO cut. Taking a cut from a duel nobody
    // won would be the house charging for a non-result.
    if cs == os {
        let a = payout(state, &duel.challenger_wallet, duel.stake_g as u64, &format!("duel:{}:draw:{}", id, duel.challenger_wallet)).await;
        let b = payout(state, &opponent, duel.stake_g as u64, &format!("duel:{}:draw:{}", id, opponent)).await;
        tracing::info!("duel {} drawn at {} — both refunded", id, cs);
        return HttpResponse::Ok().json(json!({
            "id": id, "resolved": true, "draw": true,
            "challenger_score": cs, "opponent_score": os,
            "refund_txs": [a, b],
        }));
    }

    let winner = if cs > os { duel.challenger_wallet.clone() } else { opponent.clone() };
    let take = winner_payout(duel.stake_g);
    let tx = payout(state, &winner, take, &format!("duel:{}:{}", id, winner)).await;

    let _ = sqlx::query("UPDATE duels SET winner_wallet = $1, payout_tx = $2 WHERE id = $3")
        .bind(&winner).bind(&tx).bind(id).execute(&state.db).await;

    tracing::info!("duel {} won by {} ({} vs {}) — paid {} G$", id, winner, cs, os, take);
    HttpResponse::Ok().json(json!({
        "id": id, "resolved": true, "draw": false,
        "winner": winner, "winnings_g": take,
        "challenger_score": cs, "opponent_score": os,
        "payout_tx": tx,
    }))
}

// ── POST /duels/{id}/cancel ───────────────────────────────────────────────────
/// Withdraw an unaccepted duel and refund the stake. Only valid while 'open' —
/// once someone has staked against you, the duel has to play out.
pub async fn cancel_duel(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
    body: web::Json<AcceptRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&body.wallet);

    let duel: Option<DuelRow> = sqlx::query_as("SELECT * FROM duels WHERE id = $1")
        .bind(id).fetch_optional(&state.db).await.unwrap_or(None);
    let duel = match duel {
        Some(d) => d,
        None => return HttpResponse::NotFound().json(json!({"error": "Duel not found"})),
    };
    if duel.challenger_wallet != wallet {
        return HttpResponse::Forbidden().json(json!({"error": "Not your duel"}));
    }

    let claimed = sqlx::query("UPDATE duels SET status = 'cancelled', resolved_at = now() WHERE id = $1 AND status = 'open'")
        .bind(id).execute(&state.db).await;
    if claimed.map(|r| r.rows_affected()).unwrap_or(0) != 1 {
        return HttpResponse::Conflict().json(json!({"error": "That duel can no longer be cancelled"}));
    }

    let tx = payout(&state, &wallet, duel.stake_g as u64, &format!("duel:{}:cancel", id)).await;
    tracing::info!("duel {} cancelled by {} — stake refunded", id, wallet);
    HttpResponse::Ok().json(json!({"id": id, "cancelled": true, "refund_tx": tx}))
}

// ── GET /duels ────────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct ListQuery {
    /// Optional wallet — when present, also returns that player's own duels.
    pub wallet: Option<String>,
}

pub async fn list_duels(state: web::Data<AppState>, q: web::Query<ListQuery>) -> HttpResponse {
    let open: Vec<(Uuid, String, i64, DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, challenger_wallet, stake_g, created_at FROM duels
         WHERE status = 'open' ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(&state.db).await.unwrap_or_default();

    let open_json: Vec<_> = open.into_iter().map(|(id, w, stake, at)| json!({
        "id": id, "challenger": w, "stake_g": stake,
        "winner_takes_g": winner_payout(stake), "created_at": at,
    })).collect();

    let mine_json = match q.wallet.as_deref().filter(|w| is_valid_wallet(w)) {
        Some(w) => {
            let wallet = normalize_wallet(w);
            let rows: Vec<(Uuid, String, Option<String>, i64, String, Option<String>, Option<i32>, Option<i32>)> =
                sqlx::query_as(
                    "SELECT id, challenger_wallet, opponent_wallet, stake_g, status,
                            winner_wallet, challenger_score, opponent_score
                     FROM duels WHERE challenger_wallet = $1 OR opponent_wallet = $1
                     ORDER BY created_at DESC LIMIT 25",
                )
                .bind(&wallet).fetch_all(&state.db).await.unwrap_or_default();
            rows.into_iter().map(|(id, c, o, stake, status, winner, cs, os)| json!({
                "id": id, "challenger": c, "opponent": o, "stake_g": stake,
                "status": status, "winner": winner,
                "challenger_score": cs, "opponent_score": os,
            })).collect()
        }
        None => vec![],
    };

    HttpResponse::Ok().json(json!({
        "open": open_json,
        "mine": mine_json,
        "min_stake_g": MIN_STAKE_G,
        "max_stake_g": MAX_STAKE_G,
        "house_cut_percent": HOUSE_CUT_PERCENT,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winner_takes_the_pot_minus_the_house_cut() {
        // Two 1000 G$ stakes = 2000 pot, 10% stays behind.
        assert_eq!(winner_payout(1000), 1800);
        assert_eq!(winner_payout(100), 180);
    }

    #[test]
    fn the_house_cut_is_a_real_sink() {
        // What matters economically: less leaves the pool than entered it, so a
        // duel can never mint G$ no matter how many are played.
        for stake in [100i64, 777, 50_000] {
            let pot = (stake as u64) * 2;
            assert!(winner_payout(stake) < pot, "stake {} would emit", stake);
        }
    }

    #[test]
    fn a_score_no_run_could_produce_is_rejected() {
        // Instant submit — the cheapest forgery.
        assert!(validate_score(50_000, 0.2).is_err());
        // Plausible rate, but the run is too short to be a real one.
        assert!(validate_score(100, 1.0).is_err());
        // Faster than the sim can physically award points.
        assert!(validate_score(1_000_000, 60.0).is_err());
        // A stale token is not a score.
        assert!(validate_score(100, MAX_RUN_SECS + 1.0).is_err());
        assert!(validate_score(-1, 60.0).is_err());
    }

    #[test]
    fn an_ordinary_run_is_accepted() {
        assert!(validate_score(4_000, 120.0).is_ok());
        assert!(validate_score(0, 30.0).is_ok(), "scoring zero is a legitimate result");
    }
}
