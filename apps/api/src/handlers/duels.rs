//! B4 — staked async score-duels on Celo.
//!
//! Two players stake the same amount, both play the SAME seeded run separately, and
//! the higher server-validated score takes the pot minus a house cut. There is no
//! live netcode here on purpose: with no shared real-time simulation there is
//! nothing to desync, and the only thing a client reports is a score the server
//! range-checks against elapsed time it measured itself.
//!
//! WHERE THE MONEY SITS
//! --------------------
//!   stake   player -> ValorRewardPool  via `transfer_g_for`
//!   payout  ValorRewardPool -> winner  via `distribute_reward`
//!
//! Stakes sit in the reward pool, which the operator controls. That is fine for a
//! side mode on a chain whose main business is paying out UBI-funded rewards, and
//! it reuses rails that were already proven.

use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use ethers::types::{Address, U256};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::utils::{display_name, is_valid_wallet, normalize_wallet};
use crate::services::push::notify;
use crate::AppState;

/// House cut in BASIS POINTS (1 bp = 0.01%), taken out of the pot and left in the
/// Valor RewardPool. Basis points rather than a percent because the rate is 0.5%,
/// which is not expressible as an integer percent — storing it as `0` or rounding
/// to 1% would silently change what players are charged.
///
/// This is the sink that keeps duels from being a pure wash: two stakes come in,
/// slightly less than two go out, and the remainder stays in the pool.
const HOUSE_CUT_BPS: u64 = 50; // 0.5%

/// The agreed stake amounts. A duel is only fair if both sides put up the SAME
/// amount, so rather than let a challenger name any number, stakes come from one
/// fixed ladder that both players see. The acceptor is then agreeing to a figure
/// from a list they already know, not to whatever the challenger typed.
///
/// Enforced here rather than only in the UI: the client is not the place to decide
/// how much real money a request is allowed to move.
const STAKE_TIERS: [i64; 6] = [100, 500, 1_000, 5_000, 25_000, 50_000];

/// The ladder. Everything downstream reads this rather than the array directly, so
/// a second ladder later does not mean hunting for hardcoded tiers.
fn stake_tiers() -> &'static [i64] {
    &STAKE_TIERS
}

/// Floor and ceiling, derived from the ladder so they cannot drift apart from it.
/// The floor keeps dust duels from spamming the chain (every duel costs two escrow
/// txs plus a payout tx in native gas); the ceiling bounds what one bad run can cost.
const MIN_STAKE_G: i64 = STAKE_TIERS[0];
const MAX_STAKE_G: i64 = STAKE_TIERS[STAKE_TIERS.len() - 1];

/// `wave_race` is the original async score-duel (add_duels.sql): both players run
/// the same seeded solo Endless session independently and submit a score.
///
/// `face_off` is the real-time head-to-head arena: both players connect to the
/// same live match over `/ws/arena` and shoot each other; the server referees the
/// fight directly, so it never uses `challenger_run_token`/`opponent_run_token`/
/// `challenger_score`/`opponent_score` at all — those stay NULL for its rows.
/// Resolution comes from `resolve_live_duel` once the arena server decides a
/// winner, not from `submit_duel_score`.
const VALID_MODES: [&str; 2] = ["wave_race", "face_off"];

fn default_mode() -> String {
    "wave_race".to_string()
}

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
///
/// Integer division floors, so any fractional G$ stays in the pool rather than
/// being rounded in the winner's favour — the pool can never pay out more than it
/// took in, whatever the stake.
fn winner_payout(stake_g: i64) -> u64 {
    let pot = (stake_g as u64).saturating_mul(2);
    pot.saturating_mul(10_000 - HOUSE_CUT_BPS) / 10_000
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
    invited_wallet: Option<String>,
    mode: String,
}

/// Signed authorisation for one stake. A duel stake is a deliberate, one-off,
/// potentially large payment, so it carries its own EIP-2612 permit for EXACTLY
/// that amount — the same primitive marketplace checkout and transfer-out use.
///
/// It deliberately does NOT ride the survival re-arm session allowance. That rail
/// is capped at 50 G$ on purpose, because it authorises many signature-free spends
/// during a run; the smallest duel stake is 100 G$ and the largest is 50,000, so
/// reusing it would have meant either rejecting every stake (which is what it did)
/// or raising a safety ceiling that exists for an unrelated feature.
#[derive(Deserialize)]
pub struct StakePermit {
    pub deadline: u64,
    pub v: u8,
    pub r: String,
    pub s: String,
}

/// Move `stake` from the player into the RewardPool using their signed permit.
/// Returns the tx hash.
async fn escrow_stake(
    state: &AppState,
    wallet: &str,
    stake_g: i64,
    permit: &StakePermit,
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

    // Reject an expired signature before spending gas on a doomed permit tx.
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    if permit.deadline <= now {
        return Err(HttpResponse::BadRequest()
            .json(json!({"error": "Signature expired — try again"})));
    }

    let need = g_wei(stake_g as u64);
    let balance = chain.g_balance(owner).await.unwrap_or_else(|_| U256::zero());
    if balance < need {
        return Err(HttpResponse::PaymentRequired().json(json!({
            "error": "Not enough G$ for this stake", "stake_g": stake_g,
        })));
    }

    match chain
        .transfer_g_for(owner, pool, need, permit.deadline, permit.v, &permit.r, &permit.s)
        .await
    {
        Ok(hash) => {
            let tx_hash = format!("{:?}", hash);
            crate::handlers::ledger::insert_ledger_entry(
                &state.db, wallet, "duel_stake",
                rust_decimal::Decimal::from(-stake_g), Some(&tx_hash), None,
                crate::services::chain_id::ChainId::Celo,
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
                crate::services::chain_id::ChainId::Celo,
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

// ── Settlement ────────────────────────────────────────────────────────────────
//
// Each of these is a transfer out of the reward pool, made idempotent by an
// on-chain reference, so a replayed request cannot pay twice.

/// Pay the winner. Returns the settlement tx hash.
async fn settle_win(state: &AppState, duel_id: Uuid, winner: &str, stake: i64) -> Option<String> {
    let take = winner_payout(stake);
    payout(state, winner, take, &format!("duel:{duel_id}:{winner}")).await
}

/// Refund both sides of a drawn duel.
async fn settle_draw(
    state: &AppState,
    duel_id: Uuid,
    challenger: &str,
    opponent: &str,
    stake: i64,
) -> Vec<Option<String>> {
    let a = payout(state, challenger, stake as u64, &format!("duel:{duel_id}:draw:{challenger}")).await;
    let b = payout(state, opponent, stake as u64, &format!("duel:{duel_id}:draw:{opponent}")).await;
    vec![a, b]
}

/// Refund a cancelled duel's stake to the challenger.
async fn settle_cancel(state: &AppState, duel_id: Uuid, challenger: &str, stake: i64) -> Option<String> {
    payout(state, challenger, stake as u64, &format!("duel:{duel_id}:cancel")).await
}

/// Resolve a `face_off` duel once a live match has ended. Called by the arena
/// server (not by an HTTP handler here) — there is no client-facing route for
/// this, because a live match's winner is decided by the referee, not reported
/// by either player.
///
/// `winner_wallet: None` means a draw (mutual timeout at equal HP); reuses the
/// exact same `settle_win`/`settle_draw` payout rails `wave_race` resolution
/// does, so the stake/house-cut/idempotency behaviour is identical between
/// modes — only how a winner gets decided differs.
#[allow(dead_code)] // wired in once the arena server (Phase 2/3) can call it
pub async fn resolve_live_duel(
    state: &AppState,
    duel_id: Uuid,
    winner_wallet: Option<&str>,
) -> Result<HttpResponse, HttpResponse> {
    let duel: Option<DuelRow> = sqlx::query_as("SELECT * FROM duels WHERE id = $1")
        .bind(duel_id).fetch_optional(&state.db).await.unwrap_or(None);
    let duel = match duel {
        Some(d) => d,
        None => return Err(HttpResponse::NotFound().json(json!({"error": "Duel not found"}))),
    };
    if duel.mode != "face_off" {
        return Err(HttpResponse::BadRequest().json(json!({"error": "Not a face-off duel"})));
    }
    let opponent = match duel.opponent_wallet.clone() {
        Some(o) => o,
        None => return Err(HttpResponse::Conflict().json(json!({"error": "Duel was never accepted"}))),
    };

    // Same race-safety as resolve_if_complete: only the caller that flips
    // 'accepted' -> 'resolved' pays out, so a retried/duplicate match-end signal
    // from the arena server can't double-settle.
    let claimed = sqlx::query(
        "UPDATE duels SET status = 'resolved', resolved_at = now(), winner_wallet = $1 WHERE id = $2 AND status = 'accepted'",
    )
    .bind(winner_wallet).bind(duel_id).execute(&state.db).await;
    if claimed.map(|r| r.rows_affected()).unwrap_or(0) != 1 {
        return Ok(HttpResponse::Ok().json(json!({
            "id": duel_id, "resolved": true, "winner": duel.winner_wallet,
        })));
    }

    match winner_wallet {
        None => {
            let txs = settle_draw(state, duel_id, &duel.challenger_wallet, &opponent, duel.stake_g).await;
            tracing::info!("face-off duel {} drawn — both refunded", duel_id);
            Ok(HttpResponse::Ok().json(json!({
                "id": duel_id, "resolved": true, "draw": true, "refund_txs": txs,
            })))
        }
        Some(winner) => {
            let take = winner_payout(duel.stake_g);
            let tx = settle_win(state, duel_id, winner, duel.stake_g).await;
            let _ = sqlx::query("UPDATE duels SET payout_tx = $1 WHERE id = $2")
                .bind(&tx).bind(duel_id).execute(&state.db).await;
            tracing::info!("face-off duel {} won by {} — paid {} G$", duel_id, winner, take);
            Ok(HttpResponse::Ok().json(json!({
                "id": duel_id, "resolved": true, "draw": false,
                "winner": winner, "winnings_g": take, "payout_tx": tx,
            })))
        }
    }
}

// ── POST /duels ───────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct CreateRequest {
    pub wallet: String,
    pub stake_g: i64,
    /// Set to challenge one specific friend instead of opening the stake to
    /// anyone. When present, only this wallet can accept — see accept_duel.
    #[serde(default)]
    pub invited_wallet: Option<String>,
    /// 'wave_race' (default, unchanged behaviour) or 'face_off'. See VALID_MODES.
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(flatten)]
    pub permit: StakePermit,
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
    let tiers = stake_tiers();
    if !tiers.contains(&body.stake_g) {
        return HttpResponse::BadRequest().json(json!({
            "error": "Pick one of the standard stake amounts",
            "stake_tiers": tiers,
        }));
    }
    if !VALID_MODES.contains(&body.mode.as_str()) {
        return HttpResponse::BadRequest().json(json!({
            "error": "Unknown duel mode", "valid_modes": VALID_MODES,
        }));
    }
    let wallet = normalize_wallet(&body.wallet);

    let invited_wallet = match &body.invited_wallet {
        Some(w) if !is_valid_wallet(w) =>
            return HttpResponse::BadRequest().json(json!({"error": "Invalid invited wallet address"})),
        Some(w) => {
            let normalized = normalize_wallet(w);
            if normalized == wallet {
                return HttpResponse::BadRequest().json(json!({"error": "You can't challenge yourself"}));
            }
            Some(normalized)
        }
        None => None,
    };

    // Reject a second open duel BEFORE escrowing, so a duplicate request can never
    // charge a stake it then has nowhere to put (the unique index would reject the
    // insert and the money would already be gone).
    let open: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM duels WHERE challenger_wallet = $1 AND status = 'open'",
    )
    .bind(&wallet).fetch_optional(&state.db).await.unwrap_or(None);
    if open.is_some() {
        return HttpResponse::Conflict().json(json!({
            "error": "You already have an open duel — cancel it or wait for someone to accept",
        }));
    }

    let id = Uuid::new_v4();

    let stake_tx = match escrow_stake(&state, &wallet, body.stake_g, &body.permit).await {
        Ok(tx) => tx,
        Err(resp) => return resp,
    };

    // face_off never uses the run-token/elapsed-time anti-cheat anchor — a live
    // match is refereed directly, so there's no independent "run" to prove was
    // real. Leaving these NULL for face_off rows is what tells resolve_if_complete
    // (wave_race-only) and resolve_live_duel (face_off-only) apart at a glance.
    let (token, started_at) = if body.mode == "wave_race" {
        (Some(Uuid::new_v4().to_string()), Some(Utc::now()))
    } else {
        (None, None)
    };
    // Positive seed only: the client feeds it to a uint-based PRNG. Still
    // generated for face_off even though it's unused there — cheaper than making
    // the column nullable for one mode that doesn't need it.
    let seed = (Uuid::new_v4().as_u128() as i64).abs();

    let inserted = sqlx::query(
        "INSERT INTO duels (id, challenger_wallet, stake_g, seed,
                            challenger_run_token, challenger_started_at, status,
                            invited_wallet, mode)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)",
    )
    .bind(id).bind(&wallet).bind(body.stake_g).bind(seed)
    .bind(&token).bind(started_at).bind(&invited_wallet).bind(&body.mode)
    .execute(&state.db).await;

    if let Err(e) = inserted {
        // The stake is already on-chain. Refund rather than strand it.
        tracing::error!("duel insert failed after escrow for {}: {} — refunding", wallet, e);
        let refunded = settle_cancel(&state, id, &wallet, body.stake_g).await;
        return HttpResponse::InternalServerError().json(json!({
            "error": "Could not open the duel — your stake was refunded",
            "refund_tx": refunded,
        }));
    }

    if let Some(ref invited) = invited_wallet {
        let challenger_name = display_name(&state.db, &wallet).await.unwrap_or_else(|| "A friend".into());
        notify(
            &state, invited.clone(),
            format!("{challenger_name} challenged you to a duel — {} G$", body.stake_g),
            "/duels",
        );
    }

    let takes = winner_payout(body.stake_g);
    tracing::info!("duel {} ({}) opened by {} for {} G$", id, body.mode, wallet, body.stake_g);
    HttpResponse::Ok().json(json!({
        "id": id, "mode": body.mode, "seed": seed, "stake_g": body.stake_g,
        "run_token": token, "stake_tx": stake_tx,
        "winner_takes_g": takes,
    }))
}

// ── POST /duels/{id}/accept ───────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct AcceptRequest {
    pub wallet: String,
    #[serde(flatten)]
    pub permit: StakePermit,
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
    if let Some(ref invited) = duel.invited_wallet {
        if invited != &wallet {
            // Same response as "not found" rather than "forbidden" — a targeted
            // challenge shouldn't confirm its own existence to a wallet it wasn't
            // sent to.
            return HttpResponse::NotFound().json(json!({"error": "Duel not found"}));
        }
    }

    let stake_tx = match escrow_stake(&state, &wallet, duel.stake_g, &body.permit).await {
        Ok(tx) => tx,
        Err(resp) => return resp,
    };

    // Same reasoning as create_duel: face_off has no async run to token/time.
    let token = if duel.mode == "wave_race" { Some(Uuid::new_v4().to_string()) } else { None };
    let now = Utc::now();
    let opponent_started_at = if duel.mode == "wave_race" { Some(now) } else { None };
    // Conditional on status = 'open' so two simultaneous accepts can't both win the
    // duel; the loser of the race is refunded rather than left staked into nothing.
    let claimed = sqlx::query(
        "UPDATE duels SET opponent_wallet = $1, opponent_run_token = $2,
                          opponent_started_at = $3, status = 'accepted', accepted_at = $4
         WHERE id = $5 AND status = 'open'",
    )
    .bind(&wallet).bind(&token).bind(opponent_started_at).bind(now).bind(id)
    .execute(&state.db).await;

    let won_race = claimed.map(|r| r.rows_affected() == 1).unwrap_or(false);
    if !won_race {
        tracing::warn!("duel {} accept race lost by {} — refunding", id, wallet);
        let refunded =
            payout(&state, &wallet, duel.stake_g as u64, &format!("duel_refund:{stake_tx}")).await;
        return HttpResponse::Conflict().json(json!({
            "error": "Someone accepted first — your stake was refunded",
            "refund_tx": refunded,
        }));
    }

    let accepter_name = display_name(&state.db, &wallet).await.unwrap_or_else(|| "A player".into());
    notify(
        &state, duel.challenger_wallet.clone(),
        format!("{accepter_name} accepted your duel challenge — {} G$", duel.stake_g),
        "/duels",
    );

    let takes = winner_payout(duel.stake_g);
    tracing::info!("duel {} ({}) accepted by {}", id, duel.mode, wallet);
    HttpResponse::Ok().json(json!({
        "id": id, "mode": duel.mode, "seed": duel.seed, "stake_g": duel.stake_g,
        "run_token": token, "stake_tx": stake_tx,
        "winner_takes_g": takes,
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
        let txs = settle_draw(state, id, &duel.challenger_wallet, &opponent, duel.stake_g).await;
        tracing::info!("duel {} drawn at {} — both refunded", id, cs);
        return HttpResponse::Ok().json(json!({
            "id": id, "resolved": true, "draw": true,
            "challenger_score": cs, "opponent_score": os,
            "refund_txs": txs,
        }));
    }

    let winner = if cs > os { duel.challenger_wallet.clone() } else { opponent.clone() };
    let take = winner_payout(duel.stake_g);
    let tx = settle_win(state, id, &winner, duel.stake_g).await;

    let _ = sqlx::query("UPDATE duels SET winner_wallet = $1, payout_tx = $2 WHERE id = $3")
        .bind(&winner).bind(&tx).bind(id).execute(&state.db).await;

    tracing::info!(
        "duel {} won by {} ({} vs {}) — paid {} G$",
        id, winner, cs, os, take
    );
    HttpResponse::Ok().json(json!({
        "id": id, "resolved": true, "draw": false,
        "winner": winner, "winnings_g": take,
        "challenger_score": cs, "opponent_score": os,
        "payout_tx": tx,
    }))
}

// ── POST /duels/{id}/cancel ───────────────────────────────────────────────────
/// Cancelling only refunds money, so it carries no permit — asking a player to
/// sign a payment authorisation to get their own stake back would be nonsense.
#[derive(Deserialize)]
pub struct CancelRequest {
    pub wallet: String,
}

/// Withdraw an unaccepted duel and refund the stake. Only valid while 'open' —
/// once someone has staked against you, the duel has to play out.
pub async fn cancel_duel(
    state: web::Data<AppState>,
    path: web::Path<Uuid>,
    body: web::Json<CancelRequest>,
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

    let tx = settle_cancel(&state, id, &wallet, duel.stake_g).await;
    tracing::info!("duel {} cancelled by {} — stake refunded", id, wallet);
    HttpResponse::Ok().json(json!({
        "id": id, "cancelled": true, "refund_tx": tx,
    }))
}

// ── GET /duels ────────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct ListQuery {
    /// Optional wallet — when present, also returns that player's own duels.
    pub wallet: Option<String>,
}

pub async fn list_duels(state: web::Data<AppState>, q: web::Query<ListQuery>) -> HttpResponse {
    // Join the player so the lobby can show a warrior rather than a hex string —
    // an address tells you nothing about who you are about to stake against.
    // COALESCE order matches how players are named elsewhere: username first,
    // character name as the fallback.
    //
    // Invited (friend-targeted) duels are excluded from this public list — they
    // are reserved for one wallet and surface separately below as `invited`, or
    // this would show a "private" challenge to everyone and let them discover it
    // even though accepting it would still be rejected.
    let open: Vec<(Uuid, String, Option<String>, i64, DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT d.id, d.challenger_wallet,
                COALESCE(NULLIF(p.username, ''), p.character_name) AS challenger_name,
                d.stake_g, d.created_at, d.mode
         FROM duels d
         LEFT JOIN players p ON p.wallet_address = d.challenger_wallet
         WHERE d.status = 'open' AND d.invited_wallet IS NULL
         ORDER BY d.created_at DESC LIMIT 50",
    )
    .fetch_all(&state.db).await.unwrap_or_default();

    let open_json: Vec<_> = open.into_iter().map(|(id, w, name, stake, at, mode)| json!({
        "id": id, "challenger": w, "challenger_name": name, "stake_g": stake,
        "winner_takes_g": winner_payout(stake), "created_at": at, "mode": mode,
    })).collect();

    let invited_json = match q.wallet.as_deref().filter(|w| is_valid_wallet(w)) {
        Some(w) => {
            let wallet = normalize_wallet(w);
            let rows: Vec<(Uuid, String, Option<String>, i64, DateTime<Utc>, String)> = sqlx::query_as(
                "SELECT d.id, d.challenger_wallet,
                        COALESCE(NULLIF(p.username, ''), p.character_name) AS challenger_name,
                        d.stake_g, d.created_at, d.mode
                 FROM duels d
                 LEFT JOIN players p ON p.wallet_address = d.challenger_wallet
                 WHERE d.status = 'open' AND d.invited_wallet = $1
                 ORDER BY d.created_at DESC LIMIT 25",
            )
            .bind(&wallet).fetch_all(&state.db).await.unwrap_or_default();
            rows.into_iter().map(|(id, w, name, stake, at, mode)| json!({
                "id": id, "challenger": w, "challenger_name": name, "stake_g": stake,
                "winner_takes_g": winner_payout(stake), "created_at": at, "mode": mode,
            })).collect()
        }
        None => vec![],
    };

    let mine_json = match q.wallet.as_deref().filter(|w| is_valid_wallet(w)) {
        Some(w) => {
            let wallet = normalize_wallet(w);
            let rows: Vec<(Uuid, String, Option<String>, Option<String>, Option<String>, i64, String, Option<String>, Option<i32>, Option<i32>, String)> =
                sqlx::query_as(
                    "SELECT d.id, d.challenger_wallet,
                            COALESCE(NULLIF(pc.username, ''), pc.character_name) AS challenger_name,
                            d.opponent_wallet,
                            COALESCE(NULLIF(po.username, ''), po.character_name) AS opponent_name,
                            d.stake_g, d.status, d.winner_wallet,
                            d.challenger_score, d.opponent_score, d.mode
                     FROM duels d
                     LEFT JOIN players pc ON pc.wallet_address = d.challenger_wallet
                     LEFT JOIN players po ON po.wallet_address = d.opponent_wallet
                     WHERE d.challenger_wallet = $1 OR d.opponent_wallet = $1
                     ORDER BY d.created_at DESC LIMIT 25",
                )
                .bind(&wallet).fetch_all(&state.db).await.unwrap_or_default();
            rows.into_iter().map(|(id, c, cn, o, on, stake, status, winner, cs, os, mode)| {
                json!({
                    "id": id, "challenger": c, "challenger_name": cn,
                    "opponent": o, "opponent_name": on, "stake_g": stake,
                    "status": status, "winner": winner,
                    "challenger_score": cs, "opponent_score": os, "mode": mode,
                })
            }).collect()
        }
        None => vec![],
    };

    let tiers = stake_tiers();
    HttpResponse::Ok().json(json!({
        "open": open_json,
        "invited": invited_json,
        "mine": mine_json,
        "stake_tiers": tiers,
        "min_stake_g": tiers.first().copied().unwrap_or(MIN_STAKE_G),
        "max_stake_g": tiers.last().copied().unwrap_or(MAX_STAKE_G),
        "house_cut_bps": HOUSE_CUT_BPS,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winner_takes_the_pot_minus_the_house_cut() {
        // Two 1000 G$ stakes = 2000 pot, 0.5% (10 G$) stays in the pool.
        assert_eq!(winner_payout(1000), 1990);
        // Two 50k stakes = 100k pot, 500 G$ retained.
        assert_eq!(winner_payout(50_000), 99_500);
    }

    #[test]
    fn the_house_cut_is_a_real_sink_at_every_stake() {
        // The property that actually matters: less leaves the pool than entered
        // it, at EVERY legal stake. At 0.5% the cut is small enough that integer
        // rounding could plausibly erase it, which would quietly turn duels into
        // a zero-sink feature — so this asserts the invariant rather than a
        // formula, and sweeps the whole legal range instead of a few examples.
        for stake in (MIN_STAKE_G..=MAX_STAKE_G).step_by(97) {
            let pot = (stake as u64) * 2;
            assert!(
                winner_payout(stake) < pot,
                "stake {} pays out {} from a pot of {} — no cut retained",
                stake, winner_payout(stake), pot,
            );
        }
    }

    #[test]
    fn every_offered_tier_is_a_legal_stake() {
        // The ladder is what both the UI and the validator read, so a tier that
        // the validator would reject would be an amount players can pick and then
        // be refused — after they have already been shown it as an option.
        for tier in STAKE_TIERS {
            assert!(STAKE_TIERS.contains(&tier));
            assert!(tier >= MIN_STAKE_G && tier <= MAX_STAKE_G);
        }
        // Ascending, so the UI can render it in order without sorting.
        let mut sorted = STAKE_TIERS;
        sorted.sort_unstable();
        assert_eq!(sorted, STAKE_TIERS, "stake tiers must stay in ascending order");
    }

    #[test]
    fn the_minimum_stake_still_retains_a_cut() {
        // The smallest pot is where rounding bites hardest: 200 G$ at 0.5% is 1 G$.
        let pot = (MIN_STAKE_G as u64) * 2;
        assert_eq!(winner_payout(MIN_STAKE_G), 199);
        assert_eq!(pot - winner_payout(MIN_STAKE_G), 1);
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
