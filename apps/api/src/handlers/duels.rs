//! B4 — staked async score-duels, on both chains.
//!
//! Two players stake the same amount, both play the SAME seeded run separately, and
//! the higher server-validated score takes the pot minus a house cut. There is no
//! live netcode here on purpose: with no shared real-time simulation there is
//! nothing to desync, and the only thing a client reports is a score the server
//! range-checks against elapsed time it measured itself.
//!
//! TWO CHAINS, TWO CUSTODY MODELS
//! ------------------------------
//! The game logic above is identical on Celo and Avalanche. Where the money sits
//! while a duel is running is not, and the difference is deliberate.
//!
//!   Celo (G$)        stake   player -> ValorRewardPool  via `transfer_g_for`
//!                    payout  ValorRewardPool -> winner  via `distribute_reward`
//!
//!     Stakes sit in the reward pool, which the operator controls. That is fine for
//!     a side mode on a chain whose main business is paying out UBI-funded rewards,
//!     and it reuses rails that were already proven.
//!
//!   Avalanche (SCRP) stake   player -> ValorDuel contract (escrow)
//!                    payout  ValorDuel -> winner, atomically with the house cut
//!
//!     On Avalanche the duel IS the product, so the stake is held by a purpose-built
//!     escrow contract instead. The backend can tell it who won; it cannot tell it
//!     to pay anyone outside the duel, cannot withdraw the escrow, and cannot stop a
//!     player recovering their stake if the backend goes away — `reclaim` is
//!     permissionless after a timeout. See contracts/src/ValorDuel.sol.
//!
//! Everything below that branches on chain branches for that reason and no other.

use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use ethers::types::{Address, U256};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::services::avalanche::duel_id_bytes;
use crate::services::chain_id::ChainId;
use crate::utils::{is_valid_wallet, normalize_wallet};
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

/// The SCRP ladder, two orders of magnitude below the G$ one.
///
/// NOT a units conversion — the two currencies are unrelated and SCRP has no
/// exchange rate at all. It is sized against what a player can actually earn:
/// `SCRIP_PER_CLEAR` is 100, so clearing one op funds the 100 tier and a full
/// 15-op campaign funds roughly the top of this ladder. Reusing the G$ tiers would
/// have offered a 50,000 SCRP duel to a playerbase whose entire circulating supply
/// is smaller than that, which is a stake nobody could ever cover.
const SCRIP_STAKE_TIERS: [i64; 6] = [10, 25, 50, 100, 250, 500];

/// The ladder for one chain. Everything downstream reads this rather than the
/// arrays, so adding a third chain does not mean hunting for hardcoded tiers.
fn stake_tiers(chain: ChainId) -> &'static [i64] {
    match chain {
        ChainId::Celo => &STAKE_TIERS,
        ChainId::Avalanche => &SCRIP_STAKE_TIERS,
    }
}

/// Floor and ceiling, derived from the ladder so they cannot drift apart from it.
/// The floor keeps dust duels from spamming the chain (every duel costs two escrow
/// txs plus a payout tx in native gas); the ceiling bounds what one bad run can cost.
const MIN_STAKE_G: i64 = STAKE_TIERS[0];
const MAX_STAKE_G: i64 = STAKE_TIERS[STAKE_TIERS.len() - 1];

/// Which chain a request is asking to duel on.
///
/// Defaults to Celo when absent so existing clients — which know nothing about
/// chains and send no such field — keep working exactly as before. This is the one
/// place a default is safe: a duel that omits the field is, by definition, a client
/// built before SCRP duels existed, and those were all G$.
fn requested_chain(chain_id: Option<i32>) -> Result<ChainId, HttpResponse> {
    match chain_id {
        None => Ok(ChainId::Celo),
        Some(id) => ChainId::from_i32(id).ok_or_else(|| {
            HttpResponse::BadRequest().json(json!({
                "error": "Unknown chain", "chain_id": id,
            }))
        }),
    }
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
    chain_id: i32,
}

impl DuelRow {
    /// The chain this duel settles on.
    ///
    /// An unrecognised id falls back to Celo rather than refusing to settle. Every
    /// row that could hit this predates the column and really is Celo, and a duel
    /// whose stakes are already escrowed must not become unsettleable because a
    /// future chain id appeared in the column.
    fn chain(&self) -> ChainId {
        ChainId::from_i32(self.chain_id).unwrap_or(ChainId::Celo)
    }
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

/// Escrow one side's stake, on whichever chain the duel lives.
///
/// `side` decides which contract call Avalanche makes: opening a duel carries the
/// stake amount, accepting one reads it from what the challenger already staked.
/// On Celo both are the same transfer, which is exactly why the branch is here and
/// not duplicated into the two handlers.
enum Side {
    Challenger,
    Opponent,
}

async fn escrow_stake_on(
    state: &AppState,
    chain: ChainId,
    duel_id: Uuid,
    side: Side,
    wallet: &str,
    stake: i64,
    permit: &StakePermit,
) -> Result<String, HttpResponse> {
    match chain {
        ChainId::Celo => escrow_stake(state, wallet, stake, permit).await,
        ChainId::Avalanche => escrow_scrip(state, duel_id, side, wallet, stake, permit).await,
    }
}

/// Escrow SCRP into the ValorDuel contract.
///
/// Note what is NOT checked here that the Celo path checks: a balance precondition.
/// The escrow contract pulls via `transferFrom` after consuming the permit, so an
/// underfunded player's transaction reverts on-chain and nothing moves. Pre-checking
/// would be a courtesy, not a safety property, and a courtesy that costs an RPC
/// round trip on every stake.
async fn escrow_scrip(
    state: &AppState,
    duel_id: Uuid,
    side: Side,
    wallet: &str,
    stake: i64,
    permit: &StakePermit,
) -> Result<String, HttpResponse> {
    let av = state.avalanche.as_ref().ok_or_else(|| {
        HttpResponse::ServiceUnavailable().json(json!({"error": "Avalanche relay not available"}))
    })?;
    if !av.can_duel() {
        return Err(HttpResponse::ServiceUnavailable()
            .json(json!({"error": "Staked duels are not configured on Avalanche"})));
    }
    let owner: Address = wallet
        .parse()
        .map_err(|_| HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"})))?;

    let now = chrono::Utc::now().timestamp().max(0) as u64;
    if permit.deadline <= now {
        return Err(HttpResponse::BadRequest().json(json!({"error": "Signature expired — try again"})));
    }

    let id = duel_id_bytes(duel_id);
    let amount = g_wei(stake as u64);
    let result = match side {
        Side::Challenger => {
            av.duel_open(id, owner, amount, permit.deadline, permit.v, &permit.r, &permit.s).await
        }
        Side::Opponent => {
            av.duel_accept(id, owner, permit.deadline, permit.v, &permit.r, &permit.s).await
        }
    };

    match result {
        Ok(hash) => {
            let tx_hash = format!("{hash:?}");
            crate::handlers::ledger::insert_ledger_entry(
                &state.db, wallet, "duel_stake",
                rust_decimal::Decimal::from(-stake), Some(&tx_hash), None,
                ChainId::Avalanche,
            ).await;
            Ok(tx_hash)
        }
        Err(e) => {
            tracing::error!("SCRP duel stake failed for {} on {}: {}", wallet, duel_id, e);
            Err(HttpResponse::BadGateway()
                .json(json!({"error": "Stake transfer failed — nothing was charged"})))
        }
    }
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

// ── Settlement, per chain ─────────────────────────────────────────────────────
//
// On Celo each of these is a transfer out of the reward pool, made idempotent by an
// on-chain reference. On Avalanche each is a single call to the escrow contract,
// made idempotent by the duel's own status: `resolve` on an already-resolved duel
// reverts, so a replayed request cannot pay twice.

/// Pay the winner. Returns the settlement tx hash.
async fn settle_win(
    state: &AppState,
    chain: ChainId,
    duel_id: Uuid,
    winner: &str,
    stake: i64,
) -> Option<String> {
    match chain {
        ChainId::Celo => {
            let take = winner_payout(stake);
            payout(state, winner, take, &format!("duel:{duel_id}:{winner}")).await
        }
        ChainId::Avalanche => {
            let av = state.avalanche.as_ref()?;
            let addr: Address = winner.parse().ok()?;
            match av.duel_resolve(duel_id_bytes(duel_id), addr).await {
                Ok(hash) => {
                    let tx = format!("{hash:?}");
                    // The contract computes the payout, so the ledger records what
                    // it actually pays rather than what we think it should.
                    let take = winner_payout_on(state, chain, stake).await;
                    crate::handlers::ledger::insert_ledger_entry(
                        &state.db, winner, "duel_payout",
                        rust_decimal::Decimal::from(take), Some(&tx), None,
                        ChainId::Avalanche,
                    ).await;
                    Some(tx)
                }
                Err(e) => {
                    tracing::error!("SCRP duel resolve FAILED for {} ({}): {}", winner, duel_id, e);
                    None
                }
            }
        }
    }
}

/// Refund both sides of a drawn duel.
async fn settle_draw(
    state: &AppState,
    chain: ChainId,
    duel_id: Uuid,
    challenger: &str,
    opponent: &str,
    stake: i64,
) -> Vec<Option<String>> {
    match chain {
        ChainId::Celo => {
            let a = payout(state, challenger, stake as u64, &format!("duel:{duel_id}:draw:{challenger}")).await;
            let b = payout(state, opponent, stake as u64, &format!("duel:{duel_id}:draw:{opponent}")).await;
            vec![a, b]
        }
        // One call refunds both, so a draw cannot half-settle the way two separate
        // transfers can.
        ChainId::Avalanche => {
            let Some(av) = state.avalanche.as_ref() else { return vec![None] };
            match av.duel_draw(duel_id_bytes(duel_id)).await {
                Ok(hash) => {
                    let tx = format!("{hash:?}");
                    for w in [challenger, opponent] {
                        crate::handlers::ledger::insert_ledger_entry(
                            &state.db, w, "duel_refund",
                            rust_decimal::Decimal::from(stake), Some(&tx), None,
                            ChainId::Avalanche,
                        ).await;
                    }
                    vec![Some(tx)]
                }
                Err(e) => {
                    tracing::error!("SCRP duel draw FAILED ({}): {}", duel_id, e);
                    vec![None]
                }
            }
        }
    }
}

/// Refund a cancelled duel's stake to the challenger.
async fn settle_cancel(
    state: &AppState,
    chain: ChainId,
    duel_id: Uuid,
    challenger: &str,
    stake: i64,
) -> Option<String> {
    match chain {
        ChainId::Celo => payout(state, challenger, stake as u64, &format!("duel:{duel_id}:cancel")).await,
        ChainId::Avalanche => {
            let av = state.avalanche.as_ref()?;
            match av.duel_cancel(duel_id_bytes(duel_id)).await {
                Ok(hash) => {
                    let tx = format!("{hash:?}");
                    crate::handlers::ledger::insert_ledger_entry(
                        &state.db, challenger, "duel_refund",
                        rust_decimal::Decimal::from(stake), Some(&tx), None,
                        ChainId::Avalanche,
                    ).await;
                    Some(tx)
                }
                Err(e) => {
                    tracing::error!("SCRP duel cancel FAILED ({}): {}", duel_id, e);
                    None
                }
            }
        }
    }
}

/// What a winner takes from a duel at `stake` per side.
///
/// On Avalanche this asks the contract, because the contract is what pays. Quoting
/// a locally computed figure would let a house cut changed on-chain drift away from
/// the number players are shown before they stake. Falls back to the local formula
/// only if the read fails, so an RPC blip degrades the quote rather than the duel.
async fn winner_payout_on(state: &AppState, chain: ChainId, stake: i64) -> u64 {
    match chain {
        ChainId::Celo => winner_payout(stake),
        ChainId::Avalanche => {
            let local = winner_payout(stake);
            let Some(av) = state.avalanche.as_ref() else { return local };
            match av.duel_winner_payout(g_wei(stake as u64)).await {
                Ok(wei) => (wei / U256::exp10(18)).as_u64(),
                Err(e) => {
                    tracing::warn!("could not read winnerPayout from the duel contract: {}", e);
                    local
                }
            }
        }
    }
}

// ── POST /duels ───────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct CreateRequest {
    pub wallet: String,
    pub stake_g: i64,
    /// Which chain to duel on. Absent means Celo; see `requested_chain`.
    pub chain_id: Option<i32>,
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
    let chain = match requested_chain(body.chain_id) {
        Ok(c) => c,
        Err(resp) => return resp,
    };
    let tiers = stake_tiers(chain);
    if !tiers.contains(&body.stake_g) {
        return HttpResponse::BadRequest().json(json!({
            "error": "Pick one of the standard stake amounts",
            "stake_tiers": tiers,
            "currency": chain.currency_symbol(),
        }));
    }
    let wallet = normalize_wallet(&body.wallet);

    // Reject a second open duel BEFORE escrowing, so a duplicate request can never
    // charge a stake it then has nowhere to put (the unique index would reject the
    // insert and the money would already be gone).
    //
    // Scoped to the chain, matching the unique index: an open G$ duel must not block
    // opening a SCRP one, since they draw on entirely different balances.
    let open: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM duels WHERE challenger_wallet = $1 AND chain_id = $2 AND status = 'open'",
    )
    .bind(&wallet).bind(chain.as_i32()).fetch_optional(&state.db).await.unwrap_or(None);
    if open.is_some() {
        return HttpResponse::Conflict().json(json!({
            "error": "You already have an open duel — cancel it or wait for someone to accept",
        }));
    }

    // Generated BEFORE the escrow, because on Avalanche this id is the duel's
    // identity on-chain: the contract is told about the duel as part of taking the
    // stake, so there is no ordering in which the row could come first.
    let id = Uuid::new_v4();

    let stake_tx =
        match escrow_stake_on(&state, chain, id, Side::Challenger, &wallet, body.stake_g, &body.permit).await {
            Ok(tx) => tx,
            Err(resp) => return resp,
        };

    let token = Uuid::new_v4().to_string();
    // Positive seed only: the client feeds it to a uint-based PRNG.
    let seed = (Uuid::new_v4().as_u128() as i64).abs();
    let now = Utc::now();

    let inserted = sqlx::query(
        "INSERT INTO duels (id, challenger_wallet, stake_g, seed,
                            challenger_run_token, challenger_started_at, status,
                            chain_id, challenger_stake_tx)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)",
    )
    .bind(id).bind(&wallet).bind(body.stake_g).bind(seed)
    .bind(&token).bind(now).bind(chain.as_i32()).bind(&stake_tx)
    .execute(&state.db).await;

    if let Err(e) = inserted {
        // The stake is already on-chain. Refund rather than strand it.
        //
        // On Avalanche this is a real cancel against the escrow contract, which is
        // valid precisely because the duel is still `Open` there — the contract
        // knows about it even though our database does not.
        tracing::error!("duel insert failed after escrow for {}: {} — refunding", wallet, e);
        let refunded = settle_cancel(&state, chain, id, &wallet, body.stake_g).await;
        return HttpResponse::InternalServerError().json(json!({
            "error": "Could not open the duel — your stake was refunded",
            "refund_tx": refunded,
        }));
    }

    let takes = winner_payout_on(&state, chain, body.stake_g).await;
    tracing::info!(
        "duel {} opened by {} for {} {}", id, wallet, body.stake_g, chain.currency_symbol()
    );
    HttpResponse::Ok().json(json!({
        "id": id, "seed": seed, "stake_g": body.stake_g,
        "run_token": token, "stake_tx": stake_tx,
        "winner_takes_g": takes,
        "chain_id": chain.as_i32(),
        "currency": chain.currency_symbol(),
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

    let chain = duel.chain();
    let stake_tx =
        match escrow_stake_on(&state, chain, id, Side::Opponent, &wallet, duel.stake_g, &body.permit).await {
            Ok(tx) => tx,
            Err(resp) => return resp,
        };

    let token = Uuid::new_v4().to_string();
    let now = Utc::now();
    // Conditional on status = 'open' so two simultaneous accepts can't both win the
    // duel; the loser of the race is refunded rather than left staked into nothing.
    let claimed = sqlx::query(
        "UPDATE duels SET opponent_wallet = $1, opponent_run_token = $2,
                          opponent_started_at = $3, status = 'accepted', accepted_at = $3,
                          opponent_stake_tx = $5
         WHERE id = $4 AND status = 'open'",
    )
    .bind(&wallet).bind(&token).bind(now).bind(id).bind(&stake_tx)
    .execute(&state.db).await;

    let won_race = claimed.map(|r| r.rows_affected() == 1).unwrap_or(false);
    if !won_race {
        // Losing this race is only possible on Celo. On Avalanche the escrow
        // contract is itself the lock: a second `acceptWithPermit` against a duel
        // already in `Accepted` reverts, so the loser's stake never left their
        // wallet and `escrow_stake_on` above would have returned an error instead.
        tracing::warn!("duel {} accept race lost by {} — refunding", id, wallet);
        let refunded = match chain {
            ChainId::Celo => {
                payout(&state, &wallet, duel.stake_g as u64, &format!("duel_refund:{stake_tx}")).await
            }
            ChainId::Avalanche => {
                tracing::error!(
                    "duel {} accept race lost on Avalanche, which should be impossible \
                     (the escrow contract rejects a second accept) — stake tx {}",
                    id, stake_tx
                );
                None
            }
        };
        return HttpResponse::Conflict().json(json!({
            "error": "Someone accepted first — your stake was refunded",
            "refund_tx": refunded,
        }));
    }

    let takes = winner_payout_on(&state, chain, duel.stake_g).await;
    tracing::info!("duel {} accepted by {}", id, wallet);
    HttpResponse::Ok().json(json!({
        "id": id, "seed": duel.seed, "stake_g": duel.stake_g,
        "run_token": token, "stake_tx": stake_tx,
        "winner_takes_g": takes,
        "chain_id": chain.as_i32(),
        "currency": chain.currency_symbol(),
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

    let chain = duel.chain();

    // A draw refunds both stakes and takes NO cut. Taking a cut from a duel nobody
    // won would be the house charging for a non-result.
    if cs == os {
        let txs = settle_draw(state, chain, id, &duel.challenger_wallet, &opponent, duel.stake_g).await;
        tracing::info!("duel {} drawn at {} — both refunded", id, cs);
        return HttpResponse::Ok().json(json!({
            "id": id, "resolved": true, "draw": true,
            "challenger_score": cs, "opponent_score": os,
            "refund_txs": txs,
            "chain_id": chain.as_i32(),
            "currency": chain.currency_symbol(),
        }));
    }

    let winner = if cs > os { duel.challenger_wallet.clone() } else { opponent.clone() };
    let take = winner_payout_on(state, chain, duel.stake_g).await;
    let tx = settle_win(state, chain, id, &winner, duel.stake_g).await;

    let _ = sqlx::query("UPDATE duels SET winner_wallet = $1, payout_tx = $2 WHERE id = $3")
        .bind(&winner).bind(&tx).bind(id).execute(&state.db).await;

    tracing::info!(
        "duel {} won by {} ({} vs {}) — paid {} {}",
        id, winner, cs, os, take, chain.currency_symbol()
    );
    HttpResponse::Ok().json(json!({
        "id": id, "resolved": true, "draw": false,
        "winner": winner, "winnings_g": take,
        "challenger_score": cs, "opponent_score": os,
        "payout_tx": tx,
        "chain_id": chain.as_i32(),
        "currency": chain.currency_symbol(),
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

    let chain = duel.chain();
    let tx = settle_cancel(&state, chain, id, &wallet, duel.stake_g).await;
    tracing::info!("duel {} cancelled by {} — stake refunded", id, wallet);
    HttpResponse::Ok().json(json!({
        "id": id, "cancelled": true, "refund_tx": tx,
        "chain_id": chain.as_i32(),
        "currency": chain.currency_symbol(),
    }))
}

// ── GET /duels ────────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct ListQuery {
    /// Optional wallet — when present, also returns that player's own duels.
    pub wallet: Option<String>,
    /// Which chain's lobby to show. Absent means Celo.
    pub chain_id: Option<i32>,
}

pub async fn list_duels(state: web::Data<AppState>, q: web::Query<ListQuery>) -> HttpResponse {
    let chain = match requested_chain(q.chain_id) {
        Ok(c) => c,
        Err(resp) => return resp,
    };

    // Join the player so the lobby can show a warrior rather than a hex string —
    // an address tells you nothing about who you are about to stake against.
    // COALESCE order matches how players are named elsewhere: username first,
    // character name as the fallback.
    //
    // Filtered by chain: a SCRP duel shown to a G$ player is an offer they cannot
    // accept, because accepting draws on a balance they do not have.
    let open: Vec<(Uuid, String, Option<String>, i64, DateTime<Utc>)> = sqlx::query_as(
        "SELECT d.id, d.challenger_wallet,
                COALESCE(NULLIF(p.username, ''), p.character_name) AS challenger_name,
                d.stake_g, d.created_at
         FROM duels d
         LEFT JOIN players p ON p.wallet_address = d.challenger_wallet
         WHERE d.status = 'open' AND d.chain_id = $1
         ORDER BY d.created_at DESC LIMIT 50",
    )
    .bind(chain.as_i32())
    .fetch_all(&state.db).await.unwrap_or_default();

    let open_json: Vec<_> = open.into_iter().map(|(id, w, name, stake, at)| json!({
        "id": id, "challenger": w, "challenger_name": name, "stake_g": stake,
        "winner_takes_g": winner_payout(stake), "created_at": at,
    })).collect();

    // "Mine" is deliberately NOT filtered by chain. A player's own duel history is
    // theirs wherever it happened, and hiding a resolved SCRP duel because the lobby
    // is currently showing G$ would look like the duel had vanished.
    let mine_json = match q.wallet.as_deref().filter(|w| is_valid_wallet(w)) {
        Some(w) => {
            let wallet = normalize_wallet(w);
            let rows: Vec<(Uuid, String, Option<String>, Option<String>, Option<String>, i64, String, Option<String>, Option<i32>, Option<i32>, i32)> =
                sqlx::query_as(
                    "SELECT d.id, d.challenger_wallet,
                            COALESCE(NULLIF(pc.username, ''), pc.character_name) AS challenger_name,
                            d.opponent_wallet,
                            COALESCE(NULLIF(po.username, ''), po.character_name) AS opponent_name,
                            d.stake_g, d.status, d.winner_wallet,
                            d.challenger_score, d.opponent_score, d.chain_id
                     FROM duels d
                     LEFT JOIN players pc ON pc.wallet_address = d.challenger_wallet
                     LEFT JOIN players po ON po.wallet_address = d.opponent_wallet
                     WHERE d.challenger_wallet = $1 OR d.opponent_wallet = $1
                     ORDER BY d.created_at DESC LIMIT 25",
                )
                .bind(&wallet).fetch_all(&state.db).await.unwrap_or_default();
            rows.into_iter().map(|(id, c, cn, o, on, stake, status, winner, cs, os, cid)| {
                let row_chain = ChainId::from_i32(cid).unwrap_or(ChainId::Celo);
                json!({
                    "id": id, "challenger": c, "challenger_name": cn,
                    "opponent": o, "opponent_name": on, "stake_g": stake,
                    "status": status, "winner": winner,
                    "challenger_score": cs, "opponent_score": os,
                    "chain_id": cid,
                    "currency": row_chain.currency_symbol(),
                })
            }).collect()
        }
        None => vec![],
    };

    let tiers = stake_tiers(chain);
    HttpResponse::Ok().json(json!({
        "open": open_json,
        "mine": mine_json,
        "stake_tiers": tiers,
        "min_stake_g": tiers.first().copied().unwrap_or(MIN_STAKE_G),
        "max_stake_g": tiers.last().copied().unwrap_or(MAX_STAKE_G),
        "house_cut_bps": HOUSE_CUT_BPS,
        "chain_id": chain.as_i32(),
        "currency": chain.currency_symbol(),
        // Whether staking is actually available right now. The UI uses this to
        // explain an unavailable mode instead of failing at the moment a player
        // has already committed to a stake.
        "escrow_ready": match chain {
            ChainId::Celo => state.chain.is_some(),
            ChainId::Avalanche => state.avalanche.as_ref().map(|a| a.can_duel()).unwrap_or(false),
        },
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

    // ── multichain ────────────────────────────────────────────────────────────

    #[test]
    fn a_missing_chain_means_celo() {
        // Every client built before SCRP duels sends no chain field, and every duel
        // those clients ever opened was G$. Defaulting anywhere else would reroute
        // existing players' stakes onto a chain they hold no balance on.
        assert_eq!(requested_chain(None).ok(), Some(ChainId::Celo));
    }

    #[test]
    fn an_unknown_chain_is_refused_rather_than_defaulted() {
        // The dangerous direction. Silently treating chain 1 as Celo would escrow
        // real G$ for a duel the caller believed was happening somewhere else.
        assert!(requested_chain(Some(1)).is_err());
        assert!(requested_chain(Some(43113)).is_err(), "Fuji testnet is not mainnet");
        assert!(requested_chain(Some(0)).is_err());
    }

    #[test]
    fn both_chains_resolve_to_their_own_ladder() {
        assert_eq!(stake_tiers(ChainId::Celo), &STAKE_TIERS);
        assert_eq!(stake_tiers(ChainId::Avalanche), &SCRIP_STAKE_TIERS);
    }

    #[test]
    fn the_scrip_ladder_is_reachable_by_actually_playing() {
        // SCRIP_PER_CLEAR is 100 and a campaign is 15 ops, so a player who finishes
        // the campaign has ~1,500 SCRP. A ladder whose entry tier exceeded one op's
        // reward, or whose top tier exceeded a whole campaign, would be a mode
        // nobody could enter. This is the check that the economy and the mode agree.
        const SCRIP_PER_CLEAR: i64 = 100;
        const CAMPAIGN_OPS: i64 = 15;
        assert!(
            SCRIP_STAKE_TIERS[0] <= SCRIP_PER_CLEAR,
            "the entry stake must be affordable after a single op"
        );
        assert!(
            *SCRIP_STAKE_TIERS.last().unwrap() <= SCRIP_PER_CLEAR * CAMPAIGN_OPS,
            "the top stake must be reachable inside one campaign"
        );
    }

    #[test]
    fn every_ladder_is_ascending_and_positive() {
        for chain in [ChainId::Celo, ChainId::Avalanche] {
            let tiers = stake_tiers(chain);
            assert!(!tiers.is_empty(), "{chain:?} has no stakes");
            assert!(tiers[0] > 0, "{chain:?} offers a non-positive stake");
            let mut sorted = tiers.to_vec();
            sorted.sort_unstable();
            assert_eq!(sorted, tiers, "{chain:?} tiers must be ascending for the UI");
        }
    }

    #[test]
    fn the_house_cut_is_a_real_sink_on_the_scrip_ladder_too() {
        // The G$ ladder is swept above. SCRP stakes are 10x smaller, which is where
        // a 0.5% cut is most at risk of rounding away to nothing.
        //
        // It does not: `winner_payout` floors, so a 10 SCRP stake pays 19 of a 20
        // pot and retains 1. Worth being explicit that flooring makes the EFFECTIVE
        // cut larger at small stakes — 1 in 20 is 5%, not 0.5% — because the cut
        // cannot be finer-grained than one whole SCRP. That is the right direction
        // for the pool to err in, but it is not the advertised rate, and anyone
        // reading a rate off this ladder should know it.
        assert_eq!(winner_payout(10), 19, "flooring keeps a whole unit even at the entry tier");
        for stake in &SCRIP_STAKE_TIERS[..] {
            let pot = (*stake as u64) * 2;
            assert!(
                winner_payout(*stake) < pot,
                "stake {stake} pays out {} of a {pot} pot — no cut retained",
                winner_payout(*stake),
            );
        }
    }

    #[test]
    fn an_unrecognised_stored_chain_still_settles() {
        // A duel row's chain is read on the settlement path, where the stakes are
        // ALREADY escrowed. Refusing to recognise the id there would strand real
        // money, so unlike the request path this one falls back rather than erroring.
        let row = DuelRow {
            id: Uuid::new_v4(),
            challenger_wallet: "0x1".into(),
            opponent_wallet: None,
            stake_g: 100,
            seed: 1,
            challenger_run_token: None,
            challenger_started_at: None,
            challenger_score: None,
            opponent_run_token: None,
            opponent_started_at: None,
            opponent_score: None,
            status: "open".into(),
            winner_wallet: None,
            chain_id: 999,
        };
        assert_eq!(row.chain(), ChainId::Celo);
    }

    #[test]
    fn a_stored_avalanche_duel_reads_back_as_avalanche() {
        let row = DuelRow {
            id: Uuid::new_v4(),
            challenger_wallet: "0x1".into(),
            opponent_wallet: None,
            stake_g: 50,
            seed: 1,
            challenger_run_token: None,
            challenger_started_at: None,
            challenger_score: None,
            opponent_run_token: None,
            opponent_started_at: None,
            opponent_score: None,
            status: "open".into(),
            winner_wallet: None,
            chain_id: 43114,
        };
        assert_eq!(row.chain(), ChainId::Avalanche);
        assert_eq!(row.chain().currency_symbol(), "SCRP");
    }
}
