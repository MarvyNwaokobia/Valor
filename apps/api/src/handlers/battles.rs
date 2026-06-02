use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::AppState;
use crate::services::battle::{BotFightResult, simulate_bot_fight, simulate_async_fight};

#[derive(Deserialize)]
pub struct BotFightRequest {
    pub wallet: String,
}

#[derive(Deserialize)]
pub struct ChallengeRequest {
    pub challenger_wallet: String,
    pub opponent_wallet: String,
}

pub async fn fight_bot(
    state: web::Data<AppState>,
    body: web::Json<BotFightRequest>,
) -> HttpResponse {
    let wallet = &body.wallet;

    let player = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players WHERE wallet_address = $1",
    )
    .bind(wallet)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let Some(player) = player else {
        return HttpResponse::NotFound().json(json!({"error": "Player not found"}));
    };

    let result = simulate_bot_fight(&player);
    let now = Utc::now();

    // Persist battle
    let battle_id = Uuid::new_v4();
    let _ = sqlx::query(
        "INSERT INTO battles (id, challenger_wallet, opponent_wallet, winner_wallet, rounds_data, xp_awarded_challenger, xp_awarded_opponent, is_bot, created_at)
         VALUES ($1, $2, 'bot', $3, $4, $5, 0, true, $6)",
    )
    .bind(battle_id)
    .bind(wallet)
    .bind(if result.challenger_won { wallet.as_str() } else { "bot" })
    .bind(serde_json::to_value(&result.rounds).unwrap_or_default())
    .bind(result.xp_awarded)
    .bind(now)
    .execute(&state.db)
    .await;

    // Update player XP, wins/losses, last_active
    let new_xp = (player.xp + result.xp_awarded).min(999);
    let wins = if result.challenger_won { player.wins + 1 } else { player.wins };
    let losses = if !result.challenger_won { player.losses + 1 } else { player.losses };

    let _ = sqlx::query(
        "UPDATE players SET xp = $1, wins = $2, losses = $3, last_active = $4, decay_status = 'none' WHERE wallet_address = $5",
    )
    .bind(new_xp)
    .bind(wins)
    .bind(losses)
    .bind(now)
    .bind(wallet)
    .execute(&state.db)
    .await;

    // Check for rank-up
    if new_xp >= 999 && player.xp < 999 {
        // Trigger reward distribution via GoodCollective
        // TODO: call services::rewards::distribute_rank_up_reward
    }

    HttpResponse::Ok().json(json!({
        "won": result.challenger_won,
        "xp_awarded": result.xp_awarded,
        "rounds": result.rounds,
        "new_xp": new_xp,
        "battle_id": battle_id,
    }))
}

pub async fn challenge_player(
    state: web::Data<AppState>,
    body: web::Json<ChallengeRequest>,
) -> HttpResponse {
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

    let result = simulate_async_fight(&challenger, &opponent);
    let now = Utc::now();
    let battle_id = Uuid::new_v4();
    let winner = if result.challenger_won { &body.challenger_wallet } else { &body.opponent_wallet };

    let _ = sqlx::query(
        "INSERT INTO battles (id, challenger_wallet, opponent_wallet, winner_wallet, rounds_data, xp_awarded_challenger, xp_awarded_opponent, is_bot, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)",
    )
    .bind(battle_id)
    .bind(&body.challenger_wallet)
    .bind(&body.opponent_wallet)
    .bind(winner)
    .bind(serde_json::to_value(&result.rounds).unwrap_or_default())
    .bind(result.xp_challenger)
    .bind(result.xp_opponent)
    .bind(now)
    .execute(&state.db)
    .await;

    // Update both players
    for (wallet, xp, won) in [
        (&body.challenger_wallet, result.xp_challenger, result.challenger_won),
        (&body.opponent_wallet, result.xp_opponent, !result.challenger_won),
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

    HttpResponse::Ok().json(json!({
        "winner": winner,
        "battle_id": battle_id,
        "xp_challenger": result.xp_challenger,
        "xp_opponent": result.xp_opponent,
        "rounds": result.rounds,
    }))
}
