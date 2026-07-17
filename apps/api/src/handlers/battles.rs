use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use ethers::types::Address;
use serde::Deserialize;
use serde_json::json;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::AppState;
use crate::models::player::Player;
use crate::services::battle::{BotFightSession, LiveFightSession, RoundData, fight_xp, simulate_async_fight};
use crate::utils::{is_valid_wallet, normalize_wallet};

fn uuid_to_bytes32(id: Uuid) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(id.as_bytes());
    bytes
}

#[derive(sqlx::FromRow)]
struct EquippedBoost {
    stat_boost: i32,
    category:   String,
}

async fn equipped_xp_multiplier(db: &sqlx::PgPool, wallet: &str) -> i32 {
    let has_booster: bool = sqlx::query_scalar(
        "SELECT EXISTS (
            SELECT 1 FROM inventory
            JOIN items ON inventory.item_id = items.id
            WHERE inventory.wallet_address = $1
              AND inventory.equipped = true
              AND items.category = 'booster'
        )",
    )
    .bind(wallet)
    .fetch_one(db)
    .await
    .unwrap_or(false);

    if has_booster { 2 } else { 1 }
}

async fn apply_item_boosts(db: &sqlx::PgPool, mut player: Player) -> Player {
    let boosts: Vec<EquippedBoost> = sqlx::query_as(
        "SELECT items.stat_boost, items.category
         FROM inventory
         JOIN items ON inventory.item_id = items.id
         WHERE inventory.wallet_address = $1 AND inventory.equipped = true",
    )
    .bind(&player.wallet_address)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    for b in boosts {
        match b.category.as_str() {
            "weapon" => player.attack_stat  += b.stat_boost,
            "shield" => player.defense_stat += b.stat_boost,
            _ => {}
        }
    }
    player
}

const XP_PER_RANK: i32 = 1000;
/// Flat G$ reward for reaching a new rank (crossing XP_PER_RANK). Paid once per
/// (wallet, rank), on-chain, idempotently — see award_player + settle_rank_up_reward.
const RANK_UP_REWARD_G: u64 = 500;
const VALID_MOVES: &[&str] = &["attack", "defend", "special"];

fn next_rank(rank: &str) -> Option<&'static str> {
    match rank {
        "Iron"     => Some("Bronze"),
        "Bronze"   => Some("Silver"),
        "Silver"   => Some("Gold"),
        "Gold"     => Some("Platinum"),
        "Platinum" => Some("Emerald"),
        "Emerald"  => Some("Diamond"),
        // Diamond has no next rank — a full bar past it PRESTIGES instead (see award_player).
        _          => None,
    }
}

/// One-time G$ bounty for the FIRST clear of a Campaign op. Every op pays a flat
/// 1000 G$, once — a first-clear reward, not a repeatable grind faucet (a given
/// (wallet, op) can only ever pay once; see complete_live_fight + the on-chain ref).
const FIRST_CLEAR_BOUNTY_G: u64 = 1000;

fn first_clear_bounty(_level: i32) -> u64 {
    FIRST_CLEAR_BOUNTY_G
}

struct FightOutcome {
    won:       bool,
    xp_earned: i32,
    new_xp:    i32,
    ranked_up: bool,
    new_rank:  Option<&'static str>,
    g_awarded: i64,
    prestiged: bool, // true when this fight prestiged the player (past Diamond)
    prestige_level: i32, // the player's prestige level after this fight
    battle_id: Uuid,
}

pub(crate) struct PlayerAward {
    pub xp_earned: i32,
    pub new_xp:    i32,
    pub ranked_up: bool,
    pub new_rank:  Option<&'static str>,
    pub g_awarded: i64,
    pub prestiged: bool,
    pub prestige_level: i32,
}

/// Number of rank-ups needed to reach a rank, from the Iron floor — Bronze is the 1st,
/// Diamond the 6th. Used to size the refereed-XP a rank-up bonus requires
/// (Nth rank ⇒ N × XP_PER_RANK). Prestige levels extend past Diamond: prestige P is the
/// (6 + P)th rank-up, computed inline in award_player rather than here.
fn rank_ordinal(rank: &str) -> i32 {
    match rank {
        "Iron" => 0, "Bronze" => 1, "Silver" => 2, "Gold" => 3,
        "Platinum" => 4, "Emerald" => 5, "Diamond" => 6,
        _ => 0,
    }
}

/// Award one player for a finished fight: re-read them, compute XP (× multiplier),
/// handle rank-up + its G$ reward, persist the player row, and kick the per-player
/// rank-up on-chain records. The caller decides win/loss; all amounts are computed
/// here. Used for every mode (bot, live PvE, PvP) so awards never diverge.
///
/// `reward_eligible` marks a server-verified (refereed) fight — a session-backed
/// Campaign fight, a bot fight, PvP, or a server-authoritative Endless wave. Only these
/// add to `ranked_xp_lifetime`, and a rank-up's G$ bonus is paid only when that tally
/// justifies the rank. This blocks farming the bonus through an honor-system path
/// without ever denying honest progression — rank still advances for all XP.
///
/// `count_result` records the win/loss on the player's W/L tally. True for real fights;
/// false for Endless waves, which award XP (and can rank up) but should not each count
/// as a "win" on the profile.
pub(crate) async fn award_player(
    state: &AppState,
    wallet: &str,
    won: bool,
    base_xp: i32,
    xp_multiplier: i32,
    reward_eligible: bool,
    count_result: bool,
) -> Result<PlayerAward, HttpResponse> {
    // Re-fetch so xp/wins/losses/rank reflect any change since the fight began.
    let player = sqlx::query_as::<_, Player>("SELECT * FROM players WHERE wallet_address = $1")
        .bind(wallet)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    let Some(player) = player else {
        return Err(HttpResponse::InternalServerError().json(json!({"error": "Player not found"})));
    };

    let now = Utc::now();

    let xp_earned  = base_xp * xp_multiplier;
    let raw_new_xp = player.xp + xp_earned;

    // A full 1000-XP bar does one of two things:
    //   • PROMOTE — advance to the next rank (Iron→…→Diamond), or
    //   • PRESTIGE — at Diamond (no next rank), bump prestige_level instead. XP is never
    //     deleted; the bar keeps counting and keeps paying, forever. This is the fix for
    //     the old Diamond bug where a full bar subtracted 1000 XP and paid nothing.
    let ranked_up   = raw_new_xp >= XP_PER_RANK;
    let promote_to  = if ranked_up { next_rank(&player.rank) } else { None };
    let prestige_up = ranked_up && promote_to.is_none() && player.rank == "Diamond";
    let new_prestige = if prestige_up { player.prestige_level + 1 } else { player.prestige_level };

    // Consume the bar ONLY when a reward event actually fires. For every real rank this
    // equals `ranked_up`; the guard just guarantees no XP is ever silently lost if an
    // unknown rank ever reached here without a next rank or a prestige.
    let rank_event = promote_to.is_some() || prestige_up;
    let new_xp     = if rank_event { raw_new_xp - XP_PER_RANK } else { raw_new_xp };
    let new_rank   = promote_to;

    // A promotion or prestige pays a flat 500 G$ (RANK_UP_REWARD_G), keyed by a UNIQUE
    // string so it pays exactly once: the rank name for a promotion, "Diamond+N" for the
    // Nth prestige (rank stays "Diamond", so the plain name can't key it). The reward
    // ordinal sizes the Way-2 gate — Nth rank-up ⇒ N × XP_PER_RANK of refereed XP —
    // and prestige P is simply the (6 + P)th rank-up.
    let (reward_key, reward_ordinal): (Option<String>, i32) = if let Some(nr) = promote_to {
        (Some(nr.to_string()), rank_ordinal(nr))
    } else if prestige_up {
        (Some(format!("Diamond+{}", new_prestige)), rank_ordinal("Diamond") + new_prestige)
    } else {
        (None, 0)
    };
    // Set here only once the DB payout slot is actually claimed (see below).
    let mut g_awarded = 0i64;

    let wins   = if count_result && won  { player.wins + 1 }   else { player.wins };
    let losses = if count_result && !won { player.losses + 1 } else { player.losses };

    // Refereed-XP tally (Way 2). A verified fight atomically adds its XP and returns
    // the new total; an unverified one just reads the current total. Kept OUT of the
    // main player UPDATE below so a lagging migration can never block the core save —
    // if the column is missing this reads 0, which fails closed (withholds the bonus).
    let honest_xp_after: i32 = if reward_eligible && xp_earned != 0 {
        sqlx::query_scalar(
            "UPDATE players SET ranked_xp_lifetime = ranked_xp_lifetime + $1
             WHERE wallet_address = $2 RETURNING ranked_xp_lifetime",
        )
        .bind(xp_earned).bind(wallet)
        .fetch_optional(&state.db).await.ok().flatten().unwrap_or(0)
    } else {
        sqlx::query_scalar("SELECT ranked_xp_lifetime FROM players WHERE wallet_address = $1")
            .bind(wallet)
            .fetch_optional(&state.db).await.ok().flatten().unwrap_or(0)
    };

    // One UPDATE for every case. rank advances on a promotion (or stays put), and
    // prestige_level advances on a prestige (or stays put); when neither fires both bind
    // to their current value, a harmless no-op. g_earned_lifetime is bumped separately,
    // only once the G$ transfer confirms on-chain — see the tokio::spawn block.
    let new_rank_str: &str = promote_to.unwrap_or(&player.rank);
    let _ = sqlx::query(
        "UPDATE players
         SET xp = $1, wins = $2, losses = $3, rank = $4, prestige_level = $5,
             last_active = $6, decay_status = 'none'
         WHERE wallet_address = $7",
    )
    .bind(new_xp).bind(wins).bind(losses).bind(new_rank_str).bind(new_prestige)
    .bind(now).bind(wallet)
    .execute(&state.db).await;

    if let Some(reward_key) = reward_key {
        // Way 2 gate: the G$ bonus is paid only when the player's refereed lifetime XP
        // earns the level (Nth rank-up ⇒ N × XP_PER_RANK). The rank/prestige itself still
        // advances above and on-chain below — only the money is gated — so honest
        // progression is untouched while forged flat/Endless wins can never mint the bonus.
        let earned_enough = honest_xp_after >= reward_ordinal * XP_PER_RANK;

        // Claim the once-per-key payout slot idempotently: only the first request to
        // insert (wallet, reward_key) owns the payout. A retry or a concurrent duplicate
        // fight-complete hits the PK conflict and pays nothing (the on-chain ref guard
        // is the second line of defence). The key is unique per rank AND per prestige
        // level, so every prestige past Diamond is its own one-time payout.
        let claimed = earned_enough && sqlx::query(
            "INSERT INTO rank_up_rewards (wallet_address, rank, amount)
             VALUES ($1, $2, $3) ON CONFLICT (wallet_address, rank) DO NOTHING",
        )
        .bind(wallet).bind(&reward_key).bind(RANK_UP_REWARD_G as i64)
        .execute(&state.db).await
        .map(|r| r.rows_affected() == 1)
        .unwrap_or(false);

        if claimed {
            g_awarded = RANK_UP_REWARD_G as i64;
        } else if !earned_enough {
            tracing::info!(
                "rank-up bonus withheld for {} → {}: refereed XP {} < {}",
                wallet, reward_key, honest_xp_after, reward_ordinal * XP_PER_RANK
            );
        }

        if let (Some(chain), Ok(addr)) = (state.chain.as_ref().cloned(), wallet.parse::<Address>()) {
            let db = state.db.clone();
            let wallet_owned = wallet.to_string();
            // A promotion enrolls the player in the new tier's on-chain pool; a prestige
            // does not (rank is unchanged, they're already in Diamond's pool).
            let promoted_rank: Option<String> = promote_to.map(|r| r.to_string());
            tokio::spawn(async move {
                // MONEY FIRST. Each of these takes the global tx_lock and waits for its
                // own confirmation, so whatever runs first delays everything after it —
                // and if the process dies mid-sequence, only the unrun tail is lost.
                // The player is waiting on the G$, not on the bookkeeping, so the payout
                // goes out before the on-chain record + pool enrollment rather than
                // queueing behind them. Idempotent per (wallet, key) and shared with the
                // reconcile sweep, so a failure here is re-attempted later.
                if claimed {
                    settle_rank_up_reward(&db, &chain, &wallet_owned, &reward_key, RANK_UP_REWARD_G).await;
                }
                if let Some(rank) = promoted_rank {
                    chain.record_rank_up(addr, rank.clone()).await;
                    chain.enroll_in_rank_pool(addr, &rank).await;
                }
            });
        }
    }

    Ok(PlayerAward { xp_earned, new_xp, ranked_up: rank_event, new_rank, g_awarded, prestiged: prestige_up, prestige_level: new_prestige })
}

/// Persist exactly one battle row and kick the on-chain `record_battle`. The loser
/// is whichever of challenger/opponent is not the winner; "bot"/invalid wallets map
/// to the zero address on-chain. Shared by PvE (opponent = "bot", is_bot) and PvP.
async fn persist_battle(
    state: &AppState,
    battle_id: Uuid,
    challenger: &str,
    opponent: &str,
    winner_wallet: &str,
    xp_challenger: i32,
    xp_opponent: i32,
    is_bot: bool,
    rounds_data: serde_json::Value,
    // Whether to also record this result on-chain (ValorGameRecord). PvE losses
    // skip the chain to save gas — the DB row still shows in battle history.
    record_on_chain: bool,
) {
    let now = Utc::now();
    let _ = sqlx::query(
        "INSERT INTO battles
           (id, challenger_wallet, opponent_wallet, winner_wallet,
            rounds_data, xp_awarded_challenger, xp_awarded_opponent, is_bot, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(battle_id)
    .bind(challenger)
    .bind(opponent)
    .bind(winner_wallet)
    .bind(rounds_data)
    .bind(xp_challenger)
    .bind(xp_opponent)
    .bind(is_bot)
    .bind(now)
    .execute(&state.db)
    .await;

    if let Some(chain) = state.chain.as_ref().filter(|_| record_on_chain).cloned() {
        let loser_wallet = if winner_wallet == challenger { opponent } else { challenger };
        let winner_addr = winner_wallet.parse::<Address>().unwrap_or_else(|_| Address::zero());
        let loser_addr = loser_wallet.parse::<Address>().unwrap_or_else(|_| Address::zero());
        let battle_bytes = uuid_to_bytes32(battle_id);
        let xp_u8 = xp_challenger.max(xp_opponent).min(255) as u8;
        let db = state.db.clone();
        tokio::spawn(async move {
            if let Some(hash) = chain.record_battle(battle_bytes, winner_addr, loser_addr, xp_u8, 0, is_bot).await {
                let hash_str = format!("{:?}", hash);
                let _ = sqlx::query("UPDATE battles SET game_record_tx = $1 WHERE id = $2")
                    .bind(hash_str).bind(battle_id).execute(&db).await;
            }
        });
    }
}

/// Server-authoritative finalize for a single-player-perspective fight (turn-based
/// bot fight and the real-time PvE fighter). Awards the player and records one bot
/// battle row.
async fn finalize_fight(
    state: &AppState,
    wallet: &str,
    won: bool,
    base_xp: i32,
    xp_multiplier: i32,
    rounds_data: serde_json::Value,
    // Record this result on-chain? PvE passes `won` (Option B: wins/completions
    // on-chain, losses history-only); the bot fight passes true.
    record_on_chain: bool,
    // Is this a server-verified (refereed) fight? Bot fights are; a live fight is
    // only when it's session-backed (Campaign). Gates the rank-up G$ bonus.
    reward_eligible: bool,
) -> Result<FightOutcome, HttpResponse> {
    let award = award_player(state, wallet, won, base_xp, xp_multiplier, reward_eligible, true).await?;
    let battle_id = Uuid::new_v4();
    let winner = if won { wallet } else { "bot" };
    persist_battle(state, battle_id, wallet, "bot", winner, award.xp_earned, 0, true, rounds_data, record_on_chain).await;
    Ok(FightOutcome {
        won,
        xp_earned: award.xp_earned,
        new_xp:    award.new_xp,
        ranked_up: award.ranked_up,
        new_rank:  award.new_rank,
        g_awarded: award.g_awarded,
        prestiged: award.prestiged,
        prestige_level: award.prestige_level,
        battle_id,
    })
}

/// Sessions are abandoned (no /round call) after this long are dropped.
const SESSION_TTL_SECS: u64 = 600;

#[derive(Deserialize)]
pub struct StartBotFightRequest {
    pub wallet: String,
}

#[derive(Deserialize)]
pub struct BotFightRoundRequest {
    pub session_id:   Uuid,
    pub player_move:  String,
}

#[derive(Deserialize)]
pub struct ChallengeRequest {
    pub challenger_wallet: String,
    pub opponent_wallet: String,
}

/// Starts a new bot fight session: validates the player, snapshots their
/// item-boosted stats, picks the bot's class, and stores in-progress fight
/// state server-side. The client then plays it out via `/battles/bot/round`.
pub async fn start_bot_fight(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<StartBotFightRequest>,
) -> HttpResponse {
    // Rate limit: 10 bot fights per 60 seconds per IP
    let ip = req.connection_info().realip_remote_addr()
        .unwrap_or("unknown")
        .to_string();
    if !state.battle_limiter.check(&ip) {
        return HttpResponse::TooManyRequests()
            .json(json!({"error": "Too many battles. Slow down, warrior."}));
    }

    // Validate wallet
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }

    let wallet = normalize_wallet(&body.wallet);

    let player = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let Some(player) = player else {
        return HttpResponse::NotFound().json(json!({"error": "Player not found"}));
    };

    let player = apply_item_boosts(&state.db, player).await;
    let xp_multiplier = equipped_xp_multiplier(&state.db, &wallet).await;

    // Sweep expired sessions opportunistically — no background task needed.
    state.bot_fight_sessions.retain(|_, s| s.created_at.elapsed() < Duration::from_secs(SESSION_TTL_SECS));

    let session = BotFightSession::new(wallet, &player, xp_multiplier);
    let player_class = session.player_class;
    let bot_class = session.bot_class;

    let session_id = Uuid::new_v4();
    state.bot_fight_sessions.insert(session_id, session);

    HttpResponse::Ok().json(json!({
        "session_id":   session_id,
        "player_class": player_class,
        "bot_class":    bot_class,
    }))
}

/// Resolves one round of an in-progress bot fight. On the final round, persists
/// the battle, awards XP/rank, and includes those results in the response.
pub async fn bot_fight_round(
    state: web::Data<AppState>,
    body: web::Json<BotFightRoundRequest>,
) -> HttpResponse {
    if !VALID_MOVES.contains(&body.player_move.as_str()) {
        return HttpResponse::BadRequest()
            .json(json!({"error": format!("Invalid move: {}", body.player_move)}));
    }

    struct FinalizeData {
        wallet:         String,
        xp_multiplier:  i32,
        challenger_won: bool,
        xp_awarded:     i32,
        rounds:         Vec<RoundData>,
    }

    let (round_response, finalize) = {
        let mut session = match state.bot_fight_sessions.get_mut(&body.session_id) {
            Some(s) => s,
            None => return HttpResponse::NotFound()
                .json(json!({"error": "Battle session not found or expired"})),
        };

        if session.created_at.elapsed() >= Duration::from_secs(SESSION_TTL_SECS) {
            drop(session);
            state.bot_fight_sessions.remove(&body.session_id);
            return HttpResponse::NotFound()
                .json(json!({"error": "Battle session not found or expired"}));
        }

        if body.player_move == "special" && session.player_special_used {
            return HttpResponse::BadRequest().json(json!({"error": "Special already used"}));
        }

        let round_response = session.play_round(&body.player_move);
        let finalize = if session.is_final() {
            Some(FinalizeData {
                wallet:         session.wallet.clone(),
                xp_multiplier:  session.xp_multiplier,
                challenger_won: session.challenger_won(),
                xp_awarded:     session.xp_awarded(),
                rounds:         session.rounds.clone(),
            })
        } else {
            None
        };
        (round_response, finalize)
    };

    let Some(finalize) = finalize else {
        return HttpResponse::Ok().json(json!({
            "round":       round_response.round,
            "player_move": round_response.player_move,
            "bot_move":    round_response.bot_move,
            "player_dmg":  round_response.player_dmg,
            "bot_dmg":     round_response.bot_dmg,
            "player_hp":   round_response.player_hp,
            "bot_hp":      round_response.bot_hp,
            "is_final":    false,
        }));
    };

    state.bot_fight_sessions.remove(&body.session_id);

    let rounds_json = serde_json::to_value(&finalize.rounds).unwrap_or_default();
    let outcome = match finalize_fight(
        &state,
        &finalize.wallet,
        finalize.challenger_won,
        finalize.xp_awarded,
        finalize.xp_multiplier,
        rounds_json,
        true, // bot fights record on-chain as before
        true, // bot fights are fully server-simulated — refereed, so bonus-eligible
    )
    .await
    {
        Ok(o) => o,
        Err(resp) => return resp,
    };

    HttpResponse::Ok().json(json!({
        "round":        round_response.round,
        "player_move":  round_response.player_move,
        "bot_move":     round_response.bot_move,
        "player_dmg":   round_response.player_dmg,
        "bot_dmg":      round_response.bot_dmg,
        "player_hp":    round_response.player_hp,
        "bot_hp":       round_response.bot_hp,
        "is_final":     true,
        "won":          outcome.won,
        "xp_awarded":   outcome.xp_earned,
        "xp_multiplier": finalize.xp_multiplier,
        "new_xp":       outcome.new_xp,
        "ranked_up":    outcome.ranked_up,
        "new_rank":     outcome.new_rank,
        "prestiged":    outcome.prestiged,
        "prestige_level": outcome.prestige_level,
        "g_awarded":    outcome.g_awarded,
        "battle_id":    outcome.battle_id,
    }))
}

/// How long an issued live-fight token stays valid. Generous so pre-fight story /
/// dialogue reading never expires a legit run; a genuine fight is far shorter.
const LIVE_FIGHT_TTL_SECS: u64 = 1800;

#[derive(Deserialize)]
pub struct StartLiveFightRequest {
    pub wallet: String,
    /// PvE Campaign op being played (1-based). Absent for a non-Campaign fight.
    #[serde(default)]
    pub level:  Option<i32>,
}

/// Issues a single-use token for a real-time fight and records the server-side
/// start time. For a Campaign fight it enforces the sequential unlock: you may
/// only start the op already unlocked (a replay) or the very next one — never skip
/// ahead. The client hands this token back to `/battles/fight/complete`, which is
/// the ONLY way to earn Campaign XP / a first-clear G$ bounty / a pve advance.
pub async fn start_live_fight(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<StartLiveFightRequest>,
) -> HttpResponse {
    let ip = req.connection_info().realip_remote_addr().unwrap_or("unknown").to_string();
    if !state.battle_limiter.check(&ip) {
        return HttpResponse::TooManyRequests()
            .json(json!({"error": "Too many battles. Slow down, warrior."}));
    }
    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    let wallet = normalize_wallet(&body.wallet);

    // Sequential Campaign gate — the core of closing the "skip to op 15" exploit.
    if let Some(level) = body.level {
        let current: i32 = sqlx::query_scalar("SELECT pve_level FROM players WHERE wallet_address = $1")
            .bind(&wallet)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or(0);
        if level < 1 || level > current + 1 {
            return HttpResponse::Forbidden().json(json!({
                "error": "Operation locked — clear the campaign in order",
                "locked": true, "have_level": current, "requested": level,
            }));
        }
    }

    // Sweep expired tokens opportunistically — no background task needed.
    state.live_fight_sessions.retain(|_, s| s.created_at.elapsed() < Duration::from_secs(LIVE_FIGHT_TTL_SECS));

    let session_id = Uuid::new_v4();
    state.live_fight_sessions.insert(session_id, LiveFightSession {
        wallet,
        level: body.level,
        created_at: Instant::now(),
    });

    HttpResponse::Ok().json(json!({ "session_id": session_id }))
}

#[derive(Deserialize)]
pub struct LiveFightRequest {
    pub won: bool,
    /// Campaign fights MUST carry a server-issued session (from /battles/fight/start).
    /// It fixes the wallet + level + server-measured start time so the client can no
    /// longer assert them at completion.
    #[serde(default)]
    pub session_id: Option<Uuid>,
    /// Only used on the sessionless flat path (non-Campaign, e.g. Endless): XP-only,
    /// never a bounty or a pve advance. Ignored when session_id is present.
    #[serde(default)]
    pub wallet: Option<String>,
}

/// Win XP per Campaign level — all 15 sum to exactly 1,000 (= one rank-up).
/// Mirrors CAMPAIGN_LEVELS.xpReward in apps/web/src/engine/campaign/levels.ts.
fn campaign_base_xp(level: i32) -> i32 {
    match level {
        1 => 50,  2 => 52,  3 => 54,  4 => 56,  5 => 68,
        6 => 58,  7 => 60,  8 => 62,  9 => 65,  10 => 75,
        11 => 68, 12 => 72, 13 => 76, 14 => 80, 15 => 104,
        n if n > 15 => 50 + (n - 15) * 5, // Endless
        _ => 50,
    }
}

/// Loss XP per Campaign level — scaled per level so harder levels still reward
/// the attempt. Mirrors CAMPAIGN_LEVELS.lossXp in levels.ts.
fn campaign_loss_xp(level: i32) -> i32 {
    match level {
        1 => 15,  2 => 16,  3 => 17,  4 => 18,  5 => 22,
        6 => 19,  7 => 20,  8 => 20,  9 => 21,  10 => 25,
        11 => 22, 12 => 24, 13 => 25, 14 => 27, 15 => 34,
        n if n > 15 => 15 + (n - 15) * 2, // Endless
        _ => 15,
    }
}

/// Shortest real-time fight (seconds) that still earns rewards — blocks scripted
/// instant-win spam. A genuine fight runs well past this; it only filters abuse.
const MIN_LIVE_FIGHT_SECS: f64 = 3.0;

/// Real-time fighter reward hook. The client reports only the outcome + how long
/// the fight ran; the server computes and awards everything (XP / rank / G$) via
/// the same `finalize_fight` path the turn-based bot fight uses. Guards: per-IP
/// rate limit + a minimum match duration.
pub async fn complete_live_fight(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<LiveFightRequest>,
) -> HttpResponse {
    let ip = req.connection_info().realip_remote_addr()
        .unwrap_or("unknown")
        .to_string();
    if !state.battle_limiter.check(&ip) {
        return HttpResponse::TooManyRequests()
            .json(json!({"error": "Too many battles. Slow down, warrior."}));
    }

    // Campaign fights arrive with a server-issued token; the wallet + level + real
    // duration are taken from the SERVER's record of the fight, not the client's
    // word. A sessionless request is a non-Campaign flat fight (Endless).
    let (wallet, level) = match body.session_id {
        Some(sid) => {
            let Some((_, session)) = state.live_fight_sessions.remove(&sid) else {
                return HttpResponse::BadRequest().json(json!({"error": "No active fight session"}));
            };
            let elapsed = session.created_at.elapsed();
            if elapsed >= Duration::from_secs(LIVE_FIGHT_TTL_SECS) {
                return HttpResponse::BadRequest().json(json!({"error": "Fight session expired"}));
            }
            // Server-measured duration — the client can't fake an instant win.
            if elapsed.as_secs_f64() < MIN_LIVE_FIGHT_SECS {
                return HttpResponse::BadRequest().json(json!({"error": "Fight too short to count"}));
            }
            (session.wallet, session.level)
        }
        None => {
            // Flat path: XP only. Level is forced None so a sessionless request can
            // never reach Campaign money (first-clear bounty) or a pve advance.
            let w = body.wallet.as_deref().unwrap_or("");
            if !is_valid_wallet(w) {
                return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
            }
            (normalize_wallet(w), None)
        }
    };

    let xp_multiplier = equipped_xp_multiplier(&state.db, &wallet).await;

    // A Campaign level (if any) sets the XP and unlock; otherwise it's a flat fight.
    let (base_xp, first_clear) = match level {
        Some(level) if body.won => {
            let current: i32 = sqlx::query_scalar("SELECT pve_level FROM players WHERE wallet_address = $1")
                .bind(&wallet)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
                .unwrap_or(0);
            let first = level > current;
            (campaign_base_xp(level), first)
        }
        Some(level) => (campaign_loss_xp(level), false), // lost — scaled XP per level
        None => (fight_xp(body.won), false),              // non-Campaign fight
    };

    // Carry the mission context so battle history can show "OP N · <mission> — WIN/LOSS".
    // The frontend maps `level` → the mission name (it owns the campaign data).
    let rounds = match level {
        Some(level) => json!({ "kind": "mission", "level": level, "won": body.won }),
        None => json!([]),
    };
    // Option B: record wins/completions on-chain; losses stay history-only (no gas).
    let record_on_chain = body.won;
    // Refereed (bonus-eligible) only when session-backed — the flat/Endless path is not.
    let reward_eligible = body.session_id.is_some();
    let outcome = match finalize_fight(&state, &wallet, body.won, base_xp, xp_multiplier, rounds, record_on_chain, reward_eligible).await {
        Ok(o) => o,
        Err(resp) => return resp,
    };

    // First clear advances the Campaign unlock (monotonic) AND pays a one-time
    // G$ bounty — the PvE G$ source now that ranking up no longer mints G$.
    let mut bounty_awarded: u64 = 0;
    if first_clear {
        if let Some(level) = level {
            let _ = sqlx::query("UPDATE players SET pve_level = $1 WHERE wallet_address = $2 AND pve_level < $1")
                .bind(level)
                .bind(&wallet)
                .execute(&state.db)
                .await;

            let amount = first_clear_bounty(level);
            // Claim the payout slot idempotently: only the first request to insert
            // the (wallet, level) row owns the payout. A retry or a concurrent
            // duplicate hits the PK conflict and pays nothing (and the on-chain ref
            // guard is a second line of defence).
            let claimed = sqlx::query(
                "INSERT INTO first_clear_bounties (wallet_address, level, amount)
                 VALUES ($1, $2, $3) ON CONFLICT (wallet_address, level) DO NOTHING",
            )
            .bind(&wallet).bind(level).bind(amount as i64)
            .execute(&state.db).await
            .map(|r| r.rows_affected() == 1)
            .unwrap_or(false);

            if claimed {
                bounty_awarded = amount;
                pay_first_clear_bounty(&state, wallet.clone(), level, amount);
            }
        }
    }

    HttpResponse::Ok().json(json!({
        "won":            outcome.won,
        "xp_awarded":     outcome.xp_earned,
        "xp_multiplier":  xp_multiplier,
        "new_xp":         outcome.new_xp,
        "ranked_up":      outcome.ranked_up,
        "new_rank":       outcome.new_rank,
        "prestiged":      outcome.prestiged,
        "prestige_level": outcome.prestige_level,
        "g_awarded":      outcome.g_awarded,
        "bounty_awarded": bounty_awarded,
        "battle_id":      outcome.battle_id,
        "first_clear":    first_clear,
        "level":          level,
    }))
}

/// Fire-and-forget the on-chain first-clear bounty payout. The DB row was already
/// claimed by the caller (idempotent), so this runs at most once per (wallet, op).
/// Delegates to `settle_first_clear_bounty`, which is shared with the reconcile job.
fn pay_first_clear_bounty(state: &AppState, wallet: String, level: i32, amount: u64) {
    let Some(chain) = state.chain.as_ref().cloned() else { return; };
    let db = state.db.clone();
    tokio::spawn(async move {
        settle_first_clear_bounty(&db, &chain, &wallet, level, amount).await;
    });
}

/// Attempt (or re-attempt) the on-chain payout for one claimed bounty row and
/// reconcile the row + ledger + lifetime stat to match the chain. Shared by the
/// live-fight path and the reconcile sweep, so both settle a bounty identically.
///
/// Idempotency is airtight: the on-chain `ref` guard means a given (wallet, op) can
/// pay at most once, ever. Before sending a transaction we read `rewardRefUsed(ref)`
/// so a row whose payout DID land on-chain but whose DB update was lost (RPC blip
/// after the transfer) is reconciled to `paid` without a doomed, gas-wasting retry.
/// A `failed` row never credited the ledger/lifetime, so crediting them here on a
/// successful settle cannot double-count.
async fn settle_first_clear_bounty(
    db: &sqlx::PgPool,
    chain: &crate::services::chain::ChainWriter,
    wallet: &str,
    level: i32,
    amount: u64,
) -> &'static str {
    let Ok(addr) = wallet.parse::<Address>() else {
        tracing::error!("first-clear bounty: bad wallet {}", wallet);
        return "bad_wallet";
    };
    // Deterministic on-chain idempotency key per (wallet, op).
    let reference = ethers::utils::keccak256(format!("first_clear:{}:{}", wallet, level).as_bytes());

    // If the chain already recorded this ref, the payout landed — reconcile the DB
    // instead of sending a transaction that would revert with RefAlreadyUsed.
    let already_paid = chain.reward_ref_used(reference).await.unwrap_or(false);
    let result = if already_paid { Ok(true) } else { chain.distribute_reward(addr, amount, reference).await };

    match result {
        Ok(true) => {
            // Flip to 'paid' and let ONLY the row that actually made that transition
            // credit the ledger + lifetime. The sweep now re-attempts 'pending' rows,
            // which can run while the live task is still in flight, so two settles may
            // race on one bounty; both would see Ok(true) (the on-chain ref guard makes
            // the second a no-op read). Gating the credit on rows_affected means the
            // loser credits nothing and the player is never double-counted.
            let credited = sqlx::query(
                "UPDATE first_clear_bounties SET status = 'paid'
                 WHERE wallet_address = $1 AND level = $2 AND status <> 'paid'",
            )
            .bind(wallet).bind(level).execute(db).await
            .map(|r| r.rows_affected() == 1)
            .unwrap_or(false);

            if credited {
                let _ = sqlx::query("UPDATE players SET g_earned_lifetime = g_earned_lifetime + $1 WHERE wallet_address = $2")
                    .bind(amount as i64).bind(wallet).execute(db).await;
                crate::handlers::ledger::insert_ledger_entry(
                    db, wallet, "battle_reward", rust_decimal::Decimal::from(amount), None, None,
                ).await;
                tracing::info!(
                    "first-clear bounty paid: {} op{} +{} G${}",
                    wallet, level, amount, if already_paid { " (reconciled — was already on-chain)" } else { "" }
                );
            }
            "paid"
        }
        Ok(false) => {
            tracing::warn!("Reward pool not configured — first-clear bounty for {} op{} not paid", wallet, level);
            let _ = sqlx::query("UPDATE first_clear_bounties SET status = 'failed' WHERE wallet_address = $1 AND level = $2")
                .bind(wallet).bind(level).execute(db).await;
            "unconfigured"
        }
        Err(e) => {
            tracing::error!("first-clear bounty on-chain failed for {} op{}: {}", wallet, level, e);
            let _ = sqlx::query("UPDATE first_clear_bounties SET status = 'failed' WHERE wallet_address = $1 AND level = $2")
                .bind(wallet).bind(level).execute(db).await;
            "failed"
        }
    }
}

/// Attempt (or re-attempt) the on-chain payout for one claimed rank-up reward row.
/// Mirrors `settle_first_clear_bounty`: the on-chain `ref` (keyed per wallet+rank)
/// makes it idempotent, a row whose payout landed but whose DB update was lost is
/// reconciled without a doomed retry, and the ledger/lifetime are credited only on a
/// successful settle of a `failed`/`pending` row so they can never double-count.
/// Shared by the live rank-up path and the reconcile sweep.
async fn settle_rank_up_reward(
    db: &sqlx::PgPool,
    chain: &crate::services::chain::ChainWriter,
    wallet: &str,
    rank: &str,
    amount: u64,
) -> &'static str {
    let Ok(addr) = wallet.parse::<Address>() else {
        tracing::error!("rank-up reward: bad wallet {}", wallet);
        return "bad_wallet";
    };
    // Deterministic on-chain idempotency key per (wallet, rank).
    let reference = ethers::utils::keccak256(format!("rank_up:{}:{}", wallet, rank).as_bytes());

    let already_paid = chain.reward_ref_used(reference).await.unwrap_or(false);
    let result = if already_paid { Ok(true) } else { chain.distribute_reward(addr, amount, reference).await };

    match result {
        Ok(true) => {
            // Only the settle that actually flips 'pending'/'failed' → 'paid' credits the
            // ledger + lifetime; see settle_first_clear_bounty for why (the sweep can now
            // race the live task on a 'pending' row).
            let credited = sqlx::query(
                "UPDATE rank_up_rewards SET status = 'paid'
                 WHERE wallet_address = $1 AND rank = $2 AND status <> 'paid'",
            )
            .bind(wallet).bind(rank).execute(db).await
            .map(|r| r.rows_affected() == 1)
            .unwrap_or(false);

            if credited {
                let _ = sqlx::query("UPDATE players SET g_earned_lifetime = g_earned_lifetime + $1 WHERE wallet_address = $2")
                    .bind(amount as i64).bind(wallet).execute(db).await;
                crate::handlers::ledger::insert_ledger_entry(
                    db, wallet, "battle_reward", rust_decimal::Decimal::from(amount), None, None,
                ).await;
                tracing::info!(
                    "rank-up reward paid: {} {} +{} G${}",
                    wallet, rank, amount, if already_paid { " (reconciled — was already on-chain)" } else { "" }
                );
            }
            "paid"
        }
        Ok(false) => {
            tracing::warn!("Reward pool not configured — rank-up reward for {} {} not paid", wallet, rank);
            let _ = sqlx::query("UPDATE rank_up_rewards SET status = 'failed' WHERE wallet_address = $1 AND rank = $2")
                .bind(wallet).bind(rank).execute(db).await;
            "unconfigured"
        }
        Err(e) => {
            tracing::error!("rank-up reward on-chain failed for {} {}: {}", wallet, rank, e);
            let _ = sqlx::query("UPDATE rank_up_rewards SET status = 'failed' WHERE wallet_address = $1 AND rank = $2")
                .bind(wallet).bind(rank).execute(db).await;
            "failed"
        }
    }
}

/// Cron-triggered sweep that re-attempts every `status='failed'` first-clear bounty.
/// A bounty lands in `failed` when its on-chain payout didn't confirm (RPC blip, a
/// briefly-empty or unconfigured pool) — and, because pve_level already advanced,
/// the live path never retries it. This is that retry. Safe to run repeatedly: the
/// on-chain `ref` guard makes every re-attempt idempotent (never double-pays), and
/// rows already paid on-chain are reconciled without spending gas.
///
/// Auth: shares the decay cron's `x-cron-secret` (DECAY_CRON_SECRET) so it needs no
/// new secret. Processes a bounded batch per run to cap gas/latency on the free tier.
pub async fn reconcile_first_clear_bounties(state: web::Data<AppState>, req: HttpRequest) -> HttpResponse {
    let expected = std::env::var("DECAY_CRON_SECRET").unwrap_or_default();
    let provided = req
        .headers()
        .get("x-cron-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if expected.is_empty() || provided != expected {
        return HttpResponse::Unauthorized().finish();
    }

    let Some(chain) = state.chain.as_ref().cloned() else {
        return HttpResponse::Ok().json(json!({
            "reconciled": 0, "still_failed": 0, "skipped": "chain not configured",
        }));
    };

    // Oldest-first, capped so a backlog can't make one sweep run unbounded.
    //
    // 'pending' rows are swept too, not just 'failed'. A payout row is created 'pending'
    // and only becomes 'paid'/'failed' once the spawned settle task finishes — so if the
    // process dies mid-flight (a free-tier instance spinning down kills in-flight tasks),
    // the row stays 'pending' forever and nothing ever retries it. That is real money
    // silently never delivered. The age guard keeps this sweep off rows whose live
    // attempt is plausibly still running; anything older has been abandoned.
    let rows: Vec<(String, i32, i64)> = sqlx::query_as(
        "SELECT wallet_address, level, amount
         FROM first_clear_bounties
         WHERE status = 'failed'
            OR (status = 'pending' AND created_at < now() - interval '5 minutes')
         ORDER BY created_at ASC
         LIMIT 25",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let attempted = rows.len();
    let mut reconciled = 0u32;
    for (wallet, level, amount) in rows {
        if settle_first_clear_bounty(&state.db, &chain, &wallet, level, amount.max(0) as u64).await == "paid" {
            reconciled += 1;
        }
    }

    // Same sweep for rank-up rewards (identical idempotent settle rail), including the
    // abandoned-'pending' case above.
    let rank_rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT wallet_address, rank, amount
         FROM rank_up_rewards
         WHERE status = 'failed'
            OR (status = 'pending' AND created_at < now() - interval '5 minutes')
         ORDER BY created_at ASC
         LIMIT 25",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let rank_attempted = rank_rows.len();
    let mut rank_reconciled = 0u32;
    for (wallet, rank, amount) in rank_rows {
        if settle_rank_up_reward(&state.db, &chain, &wallet, &rank, amount.max(0) as u64).await == "paid" {
            rank_reconciled += 1;
        }
    }

    // Same idempotent rail for Endless per-wave payouts.
    let (endless_attempted, endless_reconciled) =
        crate::handlers::endless::sweep_endless_rewards(&state.db, &chain).await;

    tracing::info!(
        "reward reconcile: bounties {}/{}, rank-ups {}/{}, endless {}/{} settled",
        reconciled, attempted, rank_reconciled, rank_attempted, endless_reconciled, endless_attempted
    );
    HttpResponse::Ok().json(json!({
        "attempted":         attempted,
        "reconciled":        reconciled,
        "still_failed":      attempted as u32 - reconciled,
        "rank_attempted":    rank_attempted,
        "rank_reconciled":   rank_reconciled,
        "rank_still_failed": rank_attempted as u32 - rank_reconciled,
        "endless_attempted":  endless_attempted,
        "endless_reconciled": endless_reconciled,
        "ran_at":            Utc::now().to_rfc3339(),
    }))
}

#[derive(Deserialize)]
pub struct PvpCompleteRequest {
    pub winner_wallet: String,
    pub loser_wallet:  String,
    #[serde(default)]
    pub duration_secs: f64,
}

/// Server-authoritative completion of a real-time PvP match. Called ONLY by the
/// trusted realtime sim host (GameRoom) — never by a client — so it's gated by a
/// shared secret (`PVP_SERVER_SECRET`); without that env var set it fails closed.
/// The host reports who won; the API awards BOTH players via the same `award_player`
/// path as every other mode and records one PvP (non-bot) battle row.
pub async fn complete_pvp_match(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<PvpCompleteRequest>,
) -> HttpResponse {
    // Trusted-server auth — fail closed if no secret is configured.
    let expected = std::env::var("PVP_SERVER_SECRET").ok();
    let provided = req.headers().get("x-pvp-secret").and_then(|h| h.to_str().ok()).map(str::to_string);
    match (expected, provided) {
        (Some(e), Some(p)) if !e.is_empty() && e == p => {}
        _ => return HttpResponse::Unauthorized().json(json!({"error": "Unauthorized"})),
    }

    if !is_valid_wallet(&body.winner_wallet) || !is_valid_wallet(&body.loser_wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    if body.winner_wallet.to_lowercase() == body.loser_wallet.to_lowercase() {
        return HttpResponse::BadRequest().json(json!({"error": "Winner and loser are the same player"}));
    }
    if body.duration_secs < MIN_LIVE_FIGHT_SECS {
        return HttpResponse::BadRequest().json(json!({"error": "Fight too short to count"}));
    }

    let winner = normalize_wallet(&body.winner_wallet);
    let loser  = normalize_wallet(&body.loser_wallet);
    let win_mult  = equipped_xp_multiplier(&state.db, &winner).await;
    let lose_mult = equipped_xp_multiplier(&state.db, &loser).await;

    // PvP is resolved by the trusted realtime host (secret-gated) — refereed, so both
    // sides' rank-ups are bonus-eligible.
    let aw_w = match award_player(&state, &winner, true, fight_xp(true), win_mult, true, true).await {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let aw_l = match award_player(&state, &loser, false, fight_xp(false), lose_mult, true, true).await {
        Ok(a) => a,
        Err(resp) => return resp,
    };

    let battle_id = Uuid::new_v4();
    persist_battle(&state, battle_id, &winner, &loser, &winner, aw_w.xp_earned, aw_l.xp_earned, false, json!([]), true).await;

    let side = |w: &str, a: &PlayerAward| json!({
        "wallet": w, "xp_awarded": a.xp_earned, "new_xp": a.new_xp,
        "ranked_up": a.ranked_up, "new_rank": a.new_rank, "g_awarded": a.g_awarded,
        "prestiged": a.prestiged, "prestige_level": a.prestige_level,
    });
    HttpResponse::Ok().json(json!({
        "battle_id": battle_id,
        "winner": side(&winner, &aw_w),
        "loser":  side(&loser, &aw_l),
    }))
}

pub async fn challenge_player(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<ChallengeRequest>,
) -> HttpResponse {
    // Rate limit: 5 challenges per 60 seconds per IP
    let ip = req.connection_info().realip_remote_addr()
        .unwrap_or("unknown")
        .to_string();
    if !state.battle_limiter.check(&format!("challenge:{}", ip)) {
        return HttpResponse::TooManyRequests()
            .json(json!({"error": "Too many challenges. Slow down."}));
    }

    if !is_valid_wallet(&body.challenger_wallet) || !is_valid_wallet(&body.opponent_wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    if body.challenger_wallet.to_lowercase() == body.opponent_wallet.to_lowercase() {
        return HttpResponse::BadRequest().json(json!({"error": "Cannot challenge yourself"}));
    }

    // Async multiplayer: resolve fight immediately based on stats + random seed
    let challenger = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players WHERE wallet_address = $1",
    )
    .bind(&body.challenger_wallet)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let opponent = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players WHERE wallet_address = $1",
    )
    .bind(&body.opponent_wallet)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (Some(challenger), Some(opponent)) = (challenger, opponent) else {
        return HttpResponse::NotFound().json(json!({"error": "One or both players not found"}));
    };

    let challenger = apply_item_boosts(&state.db, challenger).await;
    let opponent   = apply_item_boosts(&state.db, opponent).await;
    let ch_multiplier = equipped_xp_multiplier(&state.db, &body.challenger_wallet).await;
    let op_multiplier = equipped_xp_multiplier(&state.db, &body.opponent_wallet).await;

    let result = simulate_async_fight(&challenger, &opponent);
    let now = Utc::now();
    let battle_id = Uuid::new_v4();
    let winner = if result.challenger_won { &body.challenger_wallet } else { &body.opponent_wallet };

    let xp_challenger = result.xp_challenger * ch_multiplier;
    let xp_opponent   = result.xp_opponent   * op_multiplier;

    let _ = sqlx::query(
        "INSERT INTO battles (id, challenger_wallet, opponent_wallet, winner_wallet, rounds_data, xp_awarded_challenger, xp_awarded_opponent, is_bot, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)",
    )
    .bind(battle_id)
    .bind(&body.challenger_wallet)
    .bind(&body.opponent_wallet)
    .bind(winner)
    .bind(serde_json::to_value(&result.rounds).unwrap_or_default())
    .bind(xp_challenger)
    .bind(xp_opponent)
    .bind(now)
    .execute(&state.db)
    .await;

    // Update both players
    for (wallet, xp, won) in [
        (&body.challenger_wallet, xp_challenger, result.challenger_won),
        (&body.opponent_wallet, xp_opponent, !result.challenger_won),
    ] {
        let player = if wallet == &body.challenger_wallet { &challenger } else { &opponent };
        let new_xp = (player.xp + xp).min(999);
        let wins = if won { player.wins + 1 } else { player.wins };
        let losses = if !won { player.losses + 1 } else { player.losses };
        let _ = sqlx::query(
            "UPDATE players SET xp = $1, wins = $2, losses = $3, last_active = $4 WHERE wallet_address = $5",
        )
        .bind(new_xp).bind(wins).bind(losses).bind(now).bind(wallet)
        .execute(&state.db)
        .await;
    }

    // Background chain write — non-blocking
    if let Some(chain) = state.chain.as_ref().cloned() {
        let battle_bytes = uuid_to_bytes32(battle_id);
        let ch_addr: Option<Address> = body.challenger_wallet.parse().ok();
        let op_addr: Option<Address> = body.opponent_wallet.parse().ok();
        let ch_won = result.challenger_won;
        let xp_ch = xp_challenger.min(255) as u8;
        let xp_op = xp_opponent.min(255) as u8;
        let db = state.db.clone();
        let battle_uuid = battle_id;
        tokio::spawn(async move {
            if let (Some(ch), Some(op)) = (ch_addr, op_addr) {
                let (winner_addr, loser_addr) = if ch_won { (ch, op) } else { (op, ch) };
                if let Some(hash) = chain.record_battle(battle_bytes, winner_addr, loser_addr, xp_ch, xp_op, false).await {
                    let hash_str = format!("{:?}", hash);
                    let _ = sqlx::query(
                        "UPDATE battles SET game_record_tx = $1 WHERE id = $2",
                    )
                    .bind(hash_str)
                    .bind(battle_uuid)
                    .execute(&db)
                    .await;
                }
            }
        });
    }

    HttpResponse::Ok().json(json!({
        "winner":        winner,
        "battle_id":     battle_id,
        "xp_challenger": xp_challenger,
        "xp_opponent":   xp_opponent,
        "rounds":        result.rounds,
    }))
}

#[cfg(test)]
mod reward_amount_tests {
    use super::*;

    #[test]
    fn every_op_pays_a_flat_first_clear_bounty() {
        for level in [1, 4, 5, 7, 10, 12, 15] {
            assert_eq!(first_clear_bounty(level), 1000, "op {} bounty", level);
        }
    }

    #[test]
    fn rank_up_reward_is_500() {
        assert_eq!(RANK_UP_REWARD_G, 500);
    }

    #[test]
    fn rewards_stay_under_the_contract_cap() {
        // The on-chain ValorRewardPool.MAX_REWARD is 10_000 G$; both payouts must fit
        // in a single distributeReward call or it reverts with BadAmount.
        const MAX_REWARD_G: u64 = 10_000;
        assert!(first_clear_bounty(15) <= MAX_REWARD_G);
        assert!(RANK_UP_REWARD_G <= MAX_REWARD_G);
    }

    #[test]
    fn refereed_xp_needed_scales_with_rank() {
        // Reaching the Nth rank needs N full ranks' worth of verified XP before its
        // G$ bonus pays — so a pure honor-system (flat/Endless) grind never earns one.
        // Ladder v2: Iron floor, Bronze the 1st rank-up, Diamond the 6th.
        assert_eq!(rank_ordinal("Bronze")   * XP_PER_RANK, 1000);
        assert_eq!(rank_ordinal("Silver")   * XP_PER_RANK, 2000);
        assert_eq!(rank_ordinal("Gold")     * XP_PER_RANK, 3000);
        assert_eq!(rank_ordinal("Platinum") * XP_PER_RANK, 4000);
        assert_eq!(rank_ordinal("Emerald")  * XP_PER_RANK, 5000);
        assert_eq!(rank_ordinal("Diamond")  * XP_PER_RANK, 6000);
        // Iron is the start (never reached via a rank-up) so it gates at zero.
        assert_eq!(rank_ordinal("Iron"), 0);
    }

    #[test]
    fn prestige_reward_ordinal_extends_past_diamond() {
        // Prestige P is the (6 + P)th rank-up, so the Way-2 gate keeps scaling and a
        // grinder can't mint prestige bonuses without the refereed XP to back them.
        assert_eq!(rank_ordinal("Diamond") + 1, 7);   // Diamond I  needs 7000 refereed XP
        assert_eq!(rank_ordinal("Diamond") + 3, 9);   // Diamond III needs 9000
    }
}
