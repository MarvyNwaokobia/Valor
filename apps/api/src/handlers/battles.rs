use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use ethers::types::Address;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::AppState;
use crate::models::player::Player;
use crate::services::battle::{simulate_bot_fight_with_moves, simulate_async_fight};
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

#[derive(Deserialize)]
pub struct BotFightRequest {
    pub wallet:       String,
    pub player_moves: Vec<String>,
}

#[derive(Deserialize)]
pub struct ChallengeRequest {
    pub challenger_wallet: String,
    pub opponent_wallet: String,
}

pub async fn fight_bot(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<BotFightRequest>,
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

    // Validate moves: 1–5, all must be legal move names
    if body.player_moves.is_empty() || body.player_moves.len() > 5 {
        return HttpResponse::BadRequest().json(json!({"error": "Must submit 1–5 moves"}));
    }
    for m in &body.player_moves {
        if !VALID_MOVES.contains(&m.as_str()) {
            return HttpResponse::BadRequest()
                .json(json!({"error": format!("Invalid move: {}", m)}));
        }
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

    // Server-authoritative simulation — bot moves are generated here, not by the client
    let result = simulate_bot_fight_with_moves(&player, &body.player_moves);
    let now = Utc::now();

    // ── XP + rank-up logic ───────────────────────────────────────────
    let xp_earned  = result.xp_awarded * xp_multiplier;
    let raw_new_xp = player.xp + xp_earned;
    let ranked_up  = raw_new_xp >= XP_PER_RANK;
    let new_xp     = if ranked_up { raw_new_xp - XP_PER_RANK } else { raw_new_xp };
    let new_rank   = if ranked_up { next_rank(&player.rank) } else { None };
    let g_awarded  = new_rank.map(rank_g_reward).unwrap_or(0);

    let wins   = if result.challenger_won { player.wins + 1 } else { player.wins };
    let losses = if !result.challenger_won { player.losses + 1 } else { player.losses };

    // ── Persist battle record ────────────────────────────────────────
    let battle_id = Uuid::new_v4();
    let _ = sqlx::query(
        "INSERT INTO battles
           (id, challenger_wallet, opponent_wallet, winner_wallet,
            rounds_data, xp_awarded_challenger, xp_awarded_opponent, is_bot, created_at)
         VALUES ($1, $2, 'bot', $3, $4, $5, 0, true, $6)",
    )
    .bind(battle_id)
    .bind(&wallet)
    .bind(if result.challenger_won { wallet.as_str() } else { "bot" })
    .bind(serde_json::to_value(&result.rounds).unwrap_or_default())
    .bind(xp_earned)
    .bind(now)
    .execute(&state.db)
    .await;

    // ── Update player — include rank if ranked up ────────────────────
    if let Some(rank) = new_rank {
        let _ = sqlx::query(
            "UPDATE players
             SET xp = $1, wins = $2, losses = $3, rank = $4,
                 g_earned_lifetime = g_earned_lifetime + $5,
                 last_active = $6, decay_status = 'none'
             WHERE wallet_address = $7",
        )
        .bind(new_xp)
        .bind(wins)
        .bind(losses)
        .bind(rank)
        .bind(g_awarded)
        .bind(now)
        .bind(&wallet)
        .execute(&state.db)
        .await;
    } else {
        let _ = sqlx::query(
            "UPDATE players
             SET xp = $1, wins = $2, losses = $3,
                 last_active = $4, decay_status = 'none'
             WHERE wallet_address = $5",
        )
        .bind(new_xp)
        .bind(wins)
        .bind(losses)
        .bind(now)
        .bind(&wallet)
        .execute(&state.db)
        .await;
    }

    // Background chain write — non-blocking
    if let Some(chain) = state.chain.as_ref().cloned() {
        let battle_bytes = uuid_to_bytes32(battle_id);
        let player_addr: Option<Address> = wallet.parse().ok();
        let won = result.challenger_won;
        let xp_u8 = xp_earned.min(255) as u8;
        let db = state.db.clone();
        let battle_uuid = battle_id;
        tokio::spawn(async move {
            if let Some(addr) = player_addr {
                let (winner, loser) = if won {
                    (addr, Address::zero())
                } else {
                    (Address::zero(), addr)
                };
                if let Some(hash) = chain.record_battle(battle_bytes, winner, loser, xp_u8, 0, true).await {
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
        // Record rank-up on-chain if applicable
        if let Some(rank) = new_rank {
            let chain2 = state.chain.as_ref().cloned();
            if let (Some(chain2), Ok(addr)) = (chain2, wallet.parse::<Address>()) {
                let rank_str = rank.to_string();
                tokio::spawn(async move {
                    chain2.record_rank_up(addr, rank_str).await;
                });
            }
        }
    }

    HttpResponse::Ok().json(json!({
        "won":          result.challenger_won,
        "xp_awarded":   xp_earned,
        "xp_multiplier": xp_multiplier,
        "new_xp":       new_xp,
        "ranked_up":    ranked_up,
        "new_rank":     new_rank,
        "g_awarded":    g_awarded,
        "rounds":       result.rounds_response,
        "battle_id":    battle_id,
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
