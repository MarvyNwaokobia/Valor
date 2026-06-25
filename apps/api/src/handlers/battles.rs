use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use ethers::types::Address;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;

use crate::AppState;
use crate::models::player::Player;
use crate::services::battle::{BotFightSession, RoundData, fight_xp, simulate_async_fight};
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
const VALID_MOVES: &[&str] = &["attack", "defend", "special"];

fn next_rank(rank: &str) -> Option<&'static str> {
    match rank {
        "Bronze"   => Some("Silver"),
        "Silver"   => Some("Gold"),
        "Gold"     => Some("Platinum"),
        "Platinum" => Some("Diamond"),
        _          => None,
    }
}

fn rank_g_reward(rank: &str) -> i64 {
    match rank {
        "Silver"   => 20,
        "Gold"     => 40,
        "Platinum" => 80,
        "Diamond"  => 150,
        _          => 0,
    }
}

struct FightOutcome {
    won:       bool,
    xp_earned: i32,
    new_xp:    i32,
    ranked_up: bool,
    new_rank:  Option<&'static str>,
    g_awarded: i64,
    battle_id: Uuid,
}

struct PlayerAward {
    xp_earned: i32,
    new_xp:    i32,
    ranked_up: bool,
    new_rank:  Option<&'static str>,
    g_awarded: i64,
}

/// Award one player for a finished fight: re-read them, compute XP (× multiplier),
/// handle rank-up + its G$ reward, persist the player row, and kick the per-player
/// rank-up on-chain records. The caller decides win/loss; all amounts are computed
/// here. Used for every mode (bot, live PvE, PvP) so awards never diverge.
async fn award_player(
    state: &AppState,
    wallet: &str,
    won: bool,
    base_xp: i32,
    xp_multiplier: i32,
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
    let ranked_up  = raw_new_xp >= XP_PER_RANK;
    let new_xp     = if ranked_up { raw_new_xp - XP_PER_RANK } else { raw_new_xp };
    let new_rank   = if ranked_up { next_rank(&player.rank) } else { None };
    let g_awarded  = new_rank.map(rank_g_reward).unwrap_or(0);

    let wins   = if won { player.wins + 1 } else { player.wins };
    let losses = if !won { player.losses + 1 } else { player.losses };

    if let Some(rank) = new_rank {
        let _ = sqlx::query(
            "UPDATE players
             SET xp = $1, wins = $2, losses = $3, rank = $4,
                 g_earned_lifetime = g_earned_lifetime + $5,
                 last_active = $6, decay_status = 'none'
             WHERE wallet_address = $7",
        )
        .bind(new_xp).bind(wins).bind(losses).bind(rank)
        .bind(g_awarded).bind(now).bind(wallet)
        .execute(&state.db).await;
    } else {
        let _ = sqlx::query(
            "UPDATE players
             SET xp = $1, wins = $2, losses = $3,
                 last_active = $4, decay_status = 'none'
             WHERE wallet_address = $5",
        )
        .bind(new_xp).bind(wins).bind(losses).bind(now).bind(wallet)
        .execute(&state.db).await;
    }

    if let Some(rank) = new_rank {
        if let (Some(chain), Ok(addr)) = (state.chain.as_ref().cloned(), wallet.parse::<Address>()) {
            let rank_str = rank.to_string();
            tokio::spawn(async move {
                chain.record_rank_up(addr, rank_str.clone()).await;
                chain.enroll_in_rank_pool(addr, &rank_str).await;
            });
        }
    }

    Ok(PlayerAward { xp_earned, new_xp, ranked_up, new_rank, g_awarded })
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

    if let Some(chain) = state.chain.as_ref().cloned() {
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
) -> Result<FightOutcome, HttpResponse> {
    let award = award_player(state, wallet, won, base_xp, xp_multiplier).await?;
    let battle_id = Uuid::new_v4();
    let winner = if won { wallet } else { "bot" };
    persist_battle(state, battle_id, wallet, "bot", winner, award.xp_earned, 0, true, rounds_data).await;
    Ok(FightOutcome {
        won,
        xp_earned: award.xp_earned,
        new_xp:    award.new_xp,
        ranked_up: award.ranked_up,
        new_rank:  award.new_rank,
        g_awarded: award.g_awarded,
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
        "g_awarded":    outcome.g_awarded,
        "battle_id":    outcome.battle_id,
    }))
}

#[derive(Deserialize)]
pub struct LiveFightRequest {
    pub wallet:        String,
    pub won:           bool,
    #[serde(default)]
    pub duration_secs: f64,
    /// PvE Campaign level played (1-based), if this was a Campaign fight. Sets the
    /// XP award and, on a first clear, advances the player's unlock.
    #[serde(default)]
    pub level:         Option<i32>,
}

const FIRST_CLEAR_BONUS_XP: i32 = 50;

/// Base XP for clearing a Campaign level — mirrors CAMPAIGN_LEVELS.xpReward in
/// apps/web/src/engine/campaign/levels.ts (keep the two in sync). Endless (>15) scales.
fn campaign_base_xp(level: i32) -> i32 {
    match level {
        1 => 80,  2 => 90,  3 => 100, 4 => 115, 5 => 200,
        6 => 120, 7 => 135, 8 => 150, 9 => 165, 10 => 250,
        11 => 170, 12 => 185, 13 => 200, 14 => 220, 15 => 300,
        n if n > 15 => 150 + (n - 15) * 10, // Endless
        _ => 100,
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

    if !is_valid_wallet(&body.wallet) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }

    if body.duration_secs < MIN_LIVE_FIGHT_SECS {
        return HttpResponse::BadRequest().json(json!({"error": "Fight too short to count"}));
    }

    let wallet = normalize_wallet(&body.wallet);
    let xp_multiplier = equipped_xp_multiplier(&state.db, &wallet).await;

    // A Campaign level (if any) sets the XP and unlock; otherwise it's a flat fight.
    let (base_xp, first_clear) = match body.level {
        Some(level) if body.won => {
            let current: i32 = sqlx::query_scalar("SELECT pve_level FROM players WHERE wallet_address = $1")
                .bind(&wallet)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
                .unwrap_or(0);
            let first = level > current;
            (campaign_base_xp(level) + if first { FIRST_CLEAR_BONUS_XP } else { 0 }, first)
        }
        Some(_) => (fight_xp(false), false), // lost the level — replayable, no unlock
        None => (fight_xp(body.won), false),  // non-Campaign fight
    };

    let outcome = match finalize_fight(&state, &wallet, body.won, base_xp, xp_multiplier, json!([])).await {
        Ok(o) => o,
        Err(resp) => return resp,
    };

    // First clear advances the Campaign unlock (monotonic — never regresses).
    if first_clear {
        if let Some(level) = body.level {
            let _ = sqlx::query("UPDATE players SET pve_level = $1 WHERE wallet_address = $2 AND pve_level < $1")
                .bind(level)
                .bind(&wallet)
                .execute(&state.db)
                .await;
        }
    }

    HttpResponse::Ok().json(json!({
        "won":           outcome.won,
        "xp_awarded":    outcome.xp_earned,
        "xp_multiplier": xp_multiplier,
        "new_xp":        outcome.new_xp,
        "ranked_up":     outcome.ranked_up,
        "new_rank":      outcome.new_rank,
        "g_awarded":     outcome.g_awarded,
        "battle_id":     outcome.battle_id,
        "first_clear":   first_clear,
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

    let aw_w = match award_player(&state, &winner, true, fight_xp(true), win_mult).await {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let aw_l = match award_player(&state, &loser, false, fight_xp(false), lose_mult).await {
        Ok(a) => a,
        Err(resp) => return resp,
    };

    let battle_id = Uuid::new_v4();
    persist_battle(&state, battle_id, &winner, &loser, &winner, aw_w.xp_earned, aw_l.xp_earned, false, json!([])).await;

    let side = |w: &str, a: &PlayerAward| json!({
        "wallet": w, "xp_awarded": a.xp_earned, "new_xp": a.new_xp,
        "ranked_up": a.ranked_up, "new_rank": a.new_rank, "g_awarded": a.g_awarded,
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
