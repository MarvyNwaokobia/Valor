use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::models::player::Player;

const BATTLE_ROUNDS: u32 = 5;
const MAX_HP: i32 = 100;
const XP_WIN: i32 = 100;
const XP_LOSS: i32 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundData {
    pub round: u32,
    pub challenger_move: String,
    pub opponent_move: String,
    pub challenger_damage: i32,
    pub opponent_damage: i32,
    pub challenger_hp: i32,
    pub opponent_hp: i32,
}

pub struct BotFightResult {
    pub challenger_won: bool,
    pub xp_awarded: i32,
    pub rounds: Vec<RoundData>,
}

/// Round shape returned to the client — field names match the frontend BattleRoundResult interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BattleRoundResponse {
    pub round:      u32,
    pub player_move: String,
    pub bot_move:   String,
    pub player_dmg: i32,
    pub bot_dmg:    i32,
    pub player_hp:  i32,
    pub bot_hp:     i32,
}

pub struct BotFightWithMovesResult {
    pub challenger_won:  bool,
    pub xp_awarded:      i32,
    pub rounds:          Vec<RoundData>,          // for DB storage
    pub rounds_response: Vec<BattleRoundResponse>, // for API response
}

pub struct AsyncFightResult {
    pub challenger_won: bool,
    pub xp_challenger: i32,
    pub xp_opponent: i32,
    pub rounds: Vec<RoundData>,
}

fn bot_stats_for_rank(rank: &str) -> (i32, i32) {
    match rank {
        "Bronze" => (10, 10),
        "Silver" => (15, 15),
        "Gold" => (20, 20),
        "Platinum" => (25, 25),
        "Diamond" => (30, 30),
        _ => (10, 10),
    }
}

fn calc_damage(attack: i32, defense: i32, is_special: bool, is_defending: bool) -> i32 {
    let mut rng = rand::rng();
    let base = if is_special { 40.0 } else { 20.0 };
    let variance = base * 0.2 * (rng.random::<f64>() * 2.0 - 1.0);
    let stat_mod = 1.0 + (attack - defense) as f64 * 0.01;
    let def_mult = if is_defending { 0.5 } else { 1.0 };
    let dmg = (base + variance) * stat_mod * def_mult;
    dmg.max(1.0) as i32
}

fn pick_move(rng: &mut impl Rng, special_used: bool) -> (String, bool, bool) {
    let roll: f64 = rng.random();
    if !special_used && roll > 0.85 {
        ("special".into(), true, false)
    } else if roll > 0.5 {
        ("defend".into(), false, true)
    } else {
        ("attack".into(), false, false)
    }
}

pub fn simulate_bot_fight(player: &Player) -> BotFightResult {
    let mut rng = rand::rng();
    let (bot_atk, bot_def) = bot_stats_for_rank(&player.rank);
    let mut player_hp = MAX_HP;
    let mut bot_hp = MAX_HP;
    let mut player_special_used = false;
    let mut bot_special_used = false;
    let mut rounds = Vec::new();

    for round in 1..=BATTLE_ROUNDS {
        let (p_move, p_special, p_defend) = pick_move(&mut rng, player_special_used);
        let (b_move, b_special, b_defend) = pick_move(&mut rng, bot_special_used);
        player_special_used = player_special_used || p_special;
        bot_special_used = bot_special_used || b_special;

        let p_dmg = calc_damage(player.attack_stat, bot_def, p_special, b_defend);
        let b_dmg = calc_damage(bot_atk, player.defense_stat, b_special, p_defend);

        bot_hp = (bot_hp - p_dmg).max(0);
        player_hp = (player_hp - b_dmg).max(0);

        rounds.push(RoundData {
            round,
            challenger_move: p_move,
            opponent_move: b_move,
            challenger_damage: p_dmg,
            opponent_damage: b_dmg,
            challenger_hp: player_hp,
            opponent_hp: bot_hp,
        });

        if player_hp <= 0 || bot_hp <= 0 {
            break;
        }
    }

    let challenger_won = player_hp >= bot_hp;
    BotFightResult {
        challenger_won,
        xp_awarded: if challenger_won { XP_WIN } else { XP_LOSS },
        rounds,
    }
}

/// Simulate a bot fight using the player's submitted moves.
/// The bot's moves are generated server-side — the player cannot influence them.
/// Accepted move values: "attack" | "defend" | "special"
pub fn simulate_bot_fight_with_moves(player: &Player, player_moves: &[String]) -> BotFightWithMovesResult {
    let mut rng = rand::rng();
    let (bot_atk, bot_def) = bot_stats_for_rank(&player.rank);
    let mut player_hp = MAX_HP;
    let mut bot_hp = MAX_HP;
    let mut bot_special_used = false;
    let mut rounds = Vec::new();
    let mut rounds_response = Vec::new();

    for (idx, p_move) in player_moves.iter().enumerate() {
        let round = (idx + 1) as u32;

        let (b_move, b_special, b_defend) = pick_move(&mut rng, bot_special_used);
        bot_special_used = bot_special_used || b_special;

        let p_is_special  = p_move == "special";
        let p_is_defending = p_move == "defend";

        let p_dmg = calc_damage(player.attack_stat, bot_def,          p_is_special,  b_defend);
        let b_dmg = calc_damage(bot_atk,            player.defense_stat, b_special,  p_is_defending);

        bot_hp    = (bot_hp    - p_dmg).max(0);
        player_hp = (player_hp - b_dmg).max(0);

        rounds.push(RoundData {
            round,
            challenger_move: p_move.clone(),
            opponent_move:   b_move.clone(),
            challenger_damage: p_dmg,
            opponent_damage:   b_dmg,
            challenger_hp:     player_hp,
            opponent_hp:       bot_hp,
        });
        rounds_response.push(BattleRoundResponse {
            round,
            player_move: p_move.clone(),
            bot_move:    b_move,
            player_dmg:  p_dmg,
            bot_dmg:     b_dmg,
            player_hp,
            bot_hp,
        });

        if player_hp <= 0 || bot_hp <= 0 {
            break;
        }
    }

    let challenger_won = player_hp >= bot_hp;
    BotFightWithMovesResult {
        challenger_won,
        xp_awarded: if challenger_won { XP_WIN } else { XP_LOSS },
        rounds,
        rounds_response,
    }
}

/// Deterministic damage calculation for testing — no RNG variance.
/// Returns the floor of: base * stat_mod * def_mult, minimum 1.
pub fn calc_damage_det(attack: i32, defense: i32, is_special: bool, is_defending: bool) -> i32 {
    let base: f64 = if is_special { 40.0 } else { 20.0 };
    let stat_mod = 1.0 + (attack - defense) as f64 * 0.01;
    let def_mult = if is_defending { 0.5 } else { 1.0 };
    (base * stat_mod * def_mult).max(1.0) as i32
}

pub fn simulate_async_fight(challenger: &Player, opponent: &Player) -> AsyncFightResult {
    // Seed unused for now — rand::rng() provides sufficient variance for async fights
    let _seed: u64 = challenger.wallet_address.bytes().map(|b| b as u64).sum::<u64>()
        ^ opponent.wallet_address.bytes().map(|b| b as u64).sum::<u64>()
        ^ chrono::Utc::now().timestamp() as u64;

    let mut rng = rand::rng();
    let mut c_hp = MAX_HP;
    let mut o_hp = MAX_HP;
    let mut c_special = false;
    let mut o_special = false;
    let mut rounds = Vec::new();

    for round in 1..=BATTLE_ROUNDS {
        let (c_move, cs, cd) = pick_move(&mut rng, c_special);
        let (o_move, os, od) = pick_move(&mut rng, o_special);
        c_special = c_special || cs;
        o_special = o_special || os;

        let c_dmg = calc_damage(challenger.attack_stat, opponent.defense_stat, cs, od);
        let o_dmg = calc_damage(opponent.attack_stat, challenger.defense_stat, os, cd);

        o_hp = (o_hp - c_dmg).max(0);
        c_hp = (c_hp - o_dmg).max(0);

        rounds.push(RoundData {
            round,
            challenger_move: c_move,
            opponent_move: o_move,
            challenger_damage: c_dmg,
            opponent_damage: o_dmg,
            challenger_hp: c_hp,
            opponent_hp: o_hp,
        });

        if c_hp <= 0 || o_hp <= 0 {
            break;
        }
    }

    let challenger_won = c_hp >= o_hp;
    AsyncFightResult {
        challenger_won,
        xp_challenger: if challenger_won { XP_WIN } else { XP_LOSS },
        xp_opponent: if !challenger_won { XP_WIN } else { XP_LOSS },
        rounds,
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_player(rank: &str, atk: i32, def: i32) -> Player {
        Player {
            wallet_address:          "0xtest".into(),
            username:                None,
            display_name:            None,
            character_class:         Some("Berserker".into()),
            character_customization: serde_json::json!({}),
            play_style:              "Fighter".into(),
            avatar:                  "⚔️".into(),
            character_name:          "TestWarrior".into(),
            rank:                    rank.into(),
            xp:                      0,
            attack_stat:             atk,
            defense_stat:            def,
            speed_stat:              9,
            g_earned_lifetime:       0.0,
            last_active:             Utc::now(),
            decay_status:            "none".into(),
            decay_frozen_until:      None,
            wins:                    0,
            losses:                  0,
            created_at:              Utc::now(),
        }
    }

    // ── calc_damage_det tests ─────────────────────────────────────────────────

    #[test]
    fn damage_is_at_least_one() {
        assert!(calc_damage_det(1, 100, false, false) >= 1);
    }

    #[test]
    fn special_hits_harder_than_normal() {
        let normal  = calc_damage_det(10, 10, false, false);
        let special = calc_damage_det(10, 10, true,  false);
        assert!(special > normal, "special ({}) should exceed normal ({})", special, normal);
    }

    #[test]
    fn defending_halves_damage() {
        let undefended = calc_damage_det(10, 10, false, false);
        let defended   = calc_damage_det(10, 10, false, true);
        // defended should be approx half
        assert!(defended <= undefended / 2 + 1, "defended ({}) should be ~half of undefended ({})", defended, undefended);
    }

    #[test]
    fn higher_attack_deals_more_damage() {
        let strong = calc_damage_det(25, 5, false, false);
        let weak   = calc_damage_det(5, 25, false, false);
        assert!(strong > weak);
    }

    // ── bot_stats_for_rank ────────────────────────────────────────────────────

    #[test]
    fn bot_stats_scale_with_rank() {
        let (b_atk, _) = bot_stats_for_rank("Bronze");
        let (s_atk, _) = bot_stats_for_rank("Silver");
        let (g_atk, _) = bot_stats_for_rank("Gold");
        assert!(b_atk < s_atk && s_atk < g_atk);
    }

    #[test]
    fn unknown_rank_falls_back_to_bronze() {
        let (atk, def) = bot_stats_for_rank("Unknown");
        assert_eq!(atk, 10);
        assert_eq!(def, 10);
    }

    // ── simulate_bot_fight_with_moves ─────────────────────────────────────────

    #[test]
    fn bot_fight_runs_at_most_five_rounds() {
        let player = make_player("Bronze", 12, 10);
        let moves  = vec!["attack".into(), "attack".into(), "attack".into(), "attack".into(), "attack".into()];
        let result = simulate_bot_fight_with_moves(&player, &moves);
        assert!(result.rounds.len() <= 5 && !result.rounds.is_empty());
    }

    #[test]
    fn hp_never_goes_below_zero() {
        let player = make_player("Bronze", 12, 10);
        let moves: Vec<String> = (0..5).map(|_| "attack".into()).collect();
        let result = simulate_bot_fight_with_moves(&player, &moves);
        for r in &result.rounds {
            assert!(r.challenger_hp >= 0 && r.opponent_hp >= 0);
        }
    }

    #[test]
    fn xp_awarded_is_win_or_loss() {
        let player = make_player("Bronze", 12, 10);
        let moves: Vec<String> = (0..5).map(|_| "attack".into()).collect();
        let result = simulate_bot_fight_with_moves(&player, &moves);
        assert!(result.xp_awarded == XP_WIN || result.xp_awarded == XP_LOSS);
    }

    #[test]
    fn winner_has_higher_or_equal_hp() {
        let player = make_player("Bronze", 12, 10);
        let moves: Vec<String> = (0..5).map(|_| "attack".into()).collect();
        let result = simulate_bot_fight_with_moves(&player, &moves);
        let last = result.rounds.last().unwrap();
        if result.challenger_won {
            assert!(last.challenger_hp >= last.opponent_hp);
        } else {
            assert!(last.opponent_hp >= last.challenger_hp);
        }
    }

    // ── Rank model ────────────────────────────────────────────────────────────

    #[test]
    fn rank_next_progression() {
        assert_eq!(crate::models::player::Rank::Bronze.next(),   Some(crate::models::player::Rank::Silver));
        assert_eq!(crate::models::player::Rank::Silver.next(),   Some(crate::models::player::Rank::Gold));
        assert_eq!(crate::models::player::Rank::Diamond.next(),  None);
    }

    #[test]
    fn rank_prev_regression() {
        assert_eq!(crate::models::player::Rank::Diamond.prev(),  Some(crate::models::player::Rank::Platinum));
        assert_eq!(crate::models::player::Rank::Bronze.prev(),   None);
    }

    #[test]
    fn rank_g_reward_scales() {
        let bronze  = crate::models::player::Rank::Bronze.g_reward();
        let diamond = crate::models::player::Rank::Diamond.g_reward();
        assert!(diamond > bronze);
    }
}
