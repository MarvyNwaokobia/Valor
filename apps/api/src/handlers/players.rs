use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::AppState;

// ── PATCH /players/:wallet ────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct UpdatePlayerRequest {
    pub username:                Option<String>,
    pub display_name:            Option<String>,
    pub character_customization: Option<serde_json::Value>,
    // Decay management fields (set by client after shield/scroll use)
    pub decay_frozen_until:      Option<chrono::DateTime<Utc>>,
    pub decay_status:            Option<String>,
    pub rank:                    Option<String>,
    pub last_active:             Option<chrono::DateTime<Utc>>,
}

pub async fn update_player(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<UpdatePlayerRequest>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    // Validate username uniqueness if provided
    if let Some(ref uname) = body.username {
        if uname.len() < 3 || uname.len() > 20 {
            return HttpResponse::BadRequest().json(json!({"error": "Username must be 3–20 characters"}));
        }
        let taken: Option<(String,)> = sqlx::query_as(
            "SELECT wallet_address FROM players WHERE username = $1 AND wallet_address != $2",
        )
        .bind(uname)
        .bind(&wallet)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);

        if taken.is_some() {
            return HttpResponse::Conflict().json(json!({"error": "Username already taken"}));
        }
    }

    let result = sqlx::query_as::<_, crate::models::player::Player>(
        "UPDATE players
         SET
           username                = COALESCE($1, username),
           display_name            = COALESCE($2, display_name),
           character_customization = COALESCE($3, character_customization),
           decay_frozen_until      = COALESCE($4, decay_frozen_until),
           decay_status            = COALESCE($5, decay_status),
           rank                    = COALESCE($6, rank),
           last_active             = COALESCE($7, last_active)
         WHERE wallet_address = $8
         RETURNING *",
    )
    .bind(&body.username)
    .bind(&body.display_name)
    .bind(body.character_customization.as_ref().map(|v| sqlx::types::Json(v.clone())))
    .bind(body.decay_frozen_until)
    .bind(&body.decay_status)
    .bind(&body.rank)
    .bind(body.last_active)
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(player)) => HttpResponse::Ok().json(player),
        Ok(None) => HttpResponse::NotFound().json(json!({"error": "Player not found"})),
        Err(e) => {
            tracing::error!("Failed to update player: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /players/:wallet/username-available ───────────────────────────────────
pub async fn check_username(
    state: web::Data<AppState>,
    path: web::Path<(String, String)>,
) -> HttpResponse {
    let (wallet, username) = path.into_inner();
    if username.len() < 3 || username.len() > 20 {
        return HttpResponse::Ok().json(json!({"available": false, "reason": "Username must be 3–20 characters"}));
    }

    let taken: Option<(String,)> = sqlx::query_as(
        "SELECT wallet_address FROM players WHERE username = $1 AND wallet_address != $2",
    )
    .bind(&username)
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    HttpResponse::Ok().json(json!({"available": taken.is_none()}))
}

pub async fn get_player(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();

    let result = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(player)) => HttpResponse::Ok().json(player),
        Ok(None) => HttpResponse::NotFound().json(json!({"error": "Player not found"})),
        Err(e) => {
            tracing::error!("DB error: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

pub async fn daily_claim(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();
    let now = Utc::now();
    let cutoff = now - chrono::Duration::hours(24);

    // Check last claim
    let last: Option<(chrono::DateTime<Utc>,)> = sqlx::query_as(
        "SELECT last_claimed_at FROM daily_claims WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    if let Some((last_claimed,)) = last {
        if last_claimed > cutoff {
            return HttpResponse::TooManyRequests().json(json!({
                "error": "Already claimed today",
                "next_claim_at": last_claimed + chrono::Duration::hours(24)
            }));
        }
    }

    // Upsert daily claim record
    let upsert_result = sqlx::query(
        "INSERT INTO daily_claims (wallet_address, last_claimed_at)
         VALUES ($1, $2)
         ON CONFLICT (wallet_address) DO UPDATE SET last_claimed_at = $2",
    )
    .bind(&wallet)
    .bind(now)
    .execute(&state.db)
    .await;

    if upsert_result.is_err() {
        return HttpResponse::InternalServerError().json(json!({"error": "Failed to record claim"}));
    }

    // Update last_active
    let _ = sqlx::query(
        "UPDATE players SET last_active = $1 WHERE wallet_address = $2",
    )
    .bind(now)
    .bind(&wallet)
    .execute(&state.db)
    .await;

    // TODO: Distribute 5 G$ via GoodCollective SDK
    // This will be implemented when GoodCollective pool is configured.

    HttpResponse::Ok().json(json!({
        "success": true,
        "g_claimed": 5,
        "next_claim_at": now + chrono::Duration::hours(24)
    }))
}

pub async fn decay_check(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();
    let now = Utc::now();

    let player_result = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await;

    let player = match player_result {
        Ok(Some(p)) => p,
        Ok(None) => return HttpResponse::NotFound().json(json!({"error": "Player not found"})),
        Err(_) => return HttpResponse::InternalServerError().finish(),
    };

    // Check if decay is frozen
    if let Some(frozen_until) = player.decay_frozen_until {
        if frozen_until > now {
            return HttpResponse::Ok().json(json!({"decay_status": "none", "frozen": true}));
        }
    }

    let hours_inactive = (now - player.last_active).num_hours();
    let new_status = if hours_inactive >= 72 {
        "active"
    } else if hours_inactive >= 48 {
        "warning"
    } else {
        "none"
    };

    // Penalize if active decay — downgrade rank
    if new_status == "active" && player.decay_status != "active" {
        let _ = sqlx::query(
            "UPDATE players SET decay_status = $1, rank = CASE
                WHEN rank = 'Diamond' THEN 'Platinum'
                WHEN rank = 'Platinum' THEN 'Gold'
                WHEN rank = 'Gold' THEN 'Silver'
                WHEN rank = 'Silver' THEN 'Bronze'
                ELSE rank
             END WHERE wallet_address = $2",
        )
        .bind(new_status)
        .bind(&wallet)
        .execute(&state.db)
        .await;
    } else if new_status != player.decay_status.as_str() {
        let _ = sqlx::query("UPDATE players SET decay_status = $1 WHERE wallet_address = $2")
            .bind(new_status)
            .bind(&wallet)
            .execute(&state.db)
            .await;
    }

    HttpResponse::Ok().json(json!({"decay_status": new_status, "hours_inactive": hours_inactive}))
}

#[derive(serde::Deserialize)]
pub struct RankUpRequest {
    pub new_rank: String,
}

pub async fn rank_up_reward(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<String>,
    body: web::Json<RankUpRequest>,
) -> HttpResponse {
    let raw = path.into_inner();
    if !is_valid_wallet(&raw) {
        return HttpResponse::BadRequest().json(json!({"error": "Invalid wallet address"}));
    }
    // Rate limit: 2 rank-ups per minute per IP (prevents spam)
    let ip = req.connection_info().realip_remote_addr()
        .unwrap_or("unknown")
        .to_string();
    if !state.rank_limiter.check(&ip) {
        return HttpResponse::TooManyRequests()
            .json(json!({"error": "Rate limit exceeded"}));
    }
    let wallet = normalize_wallet(&raw);
    let new_rank = &body.new_rank;

    let reward_amounts: std::collections::HashMap<&str, u64> = [
        ("Bronze", 10), ("Silver", 20), ("Gold", 40), ("Platinum", 80), ("Diamond", 150),
    ].iter().cloned().collect();

    let Some(&amount) = reward_amounts.get(new_rank.as_str()) else {
        return HttpResponse::BadRequest().json(json!({"error": "Unknown rank"}));
    };

    // Update g_earned_lifetime in DB
    let _ = sqlx::query(
        "UPDATE players SET g_earned_lifetime = g_earned_lifetime + $1 WHERE wallet_address = $2",
    )
    .bind(amount as i64)
    .bind(&wallet)
    .execute(&state.db)
    .await;

    // On-chain G$ is distributed via the Engagement Rewards claim flow on the frontend.
    // This endpoint records the rank-up and returns the amount for the UI to display.
    tracing::info!("Rank-up recorded: {} -> {} (+{} G$)", wallet, new_rank, amount);

    HttpResponse::Ok().json(json!({
        "success": true,
        "g_awarded": amount,
    }))
}

// ── POST /players ─────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct CreatePlayerRequest {
    pub wallet_address:          String,
    pub play_style:              String,
    pub avatar:                  Option<String>,
    pub character_name:          String,
    pub username:                Option<String>,
    pub display_name:            Option<String>,
    pub character_class:         Option<String>,
    pub character_customization: Option<serde_json::Value>,
    pub attack_stat:             Option<i32>,
    pub defense_stat:            Option<i32>,
    pub speed_stat:              Option<i32>,
}

pub async fn create_player(
    state: web::Data<AppState>,
    body: web::Json<CreatePlayerRequest>,
) -> HttpResponse {
    let wallet = normalize_wallet(&body.wallet_address);
    let customization = body.character_customization.clone()
        .unwrap_or(serde_json::Value::Object(Default::default()));

    let result = sqlx::query_as::<_, crate::models::player::Player>(
        "INSERT INTO players (
            wallet_address, username, display_name, character_class,
            character_customization, play_style, avatar, character_name,
            rank, xp, attack_stat, defense_stat, speed_stat,
            g_earned_lifetime, last_active, decay_status, wins, losses
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Bronze', 0, $9, $10, $11, 0, now(), 'none', 0, 0)
         ON CONFLICT (wallet_address) DO UPDATE
           SET character_class         = COALESCE(EXCLUDED.character_class, players.character_class),
               character_customization = CASE
                 WHEN EXCLUDED.character_customization::text = '{}' THEN players.character_customization
                 ELSE EXCLUDED.character_customization
               END,
               username     = COALESCE(EXCLUDED.username, players.username),
               display_name = COALESCE(EXCLUDED.display_name, players.display_name)
         RETURNING *",
    )
    .bind(&wallet)
    .bind(&body.username)
    .bind(&body.display_name)
    .bind(&body.character_class)
    .bind(sqlx::types::Json(&customization))
    .bind(&body.play_style)
    .bind(body.avatar.as_deref().unwrap_or(""))
    .bind(&body.character_name)
    .bind(body.attack_stat.unwrap_or(10))
    .bind(body.defense_stat.unwrap_or(10))
    .bind(body.speed_stat.unwrap_or(10))
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(player) => HttpResponse::Ok().json(player),
        Err(e) => {
            tracing::error!("Failed to create player: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Failed to create player"}))
        }
    }
}

// ── GET /players ──────────────────────────────────────────────────────────────
pub async fn list_players(state: web::Data<AppState>) -> HttpResponse {
    let result = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players
         ORDER BY
           CASE rank
             WHEN 'Diamond'  THEN 1
             WHEN 'Platinum' THEN 2
             WHEN 'Gold'     THEN 3
             WHEN 'Silver'   THEN 4
             ELSE 5
           END ASC, xp DESC
         LIMIT 50",
    )
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(players) => HttpResponse::Ok().json(players),
        Err(e) => {
            tracing::error!("Failed to fetch leaderboard: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /players/:wallet/inventory ────────────────────────────────────────────
pub async fn get_inventory(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();

    #[derive(serde::Serialize, sqlx::FromRow)]
    struct InventoryRow {
        wallet_address: String,
        item_id: Uuid,
        equipped: bool,
        acquired_at: chrono::DateTime<Utc>,
    }

    let result = sqlx::query_as::<_, InventoryRow>(
        "SELECT wallet_address, item_id, equipped, acquired_at
         FROM inventory WHERE wallet_address = $1 ORDER BY acquired_at DESC",
    )
    .bind(&wallet)
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => {
            tracing::error!("Failed to fetch inventory: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── POST /players/:wallet/inventory ───────────────────────────────────────────
#[derive(Deserialize)]
pub struct AddInventoryRequest {
    pub item_id: Uuid,
}

pub async fn add_inventory_item(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<AddInventoryRequest>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    let result = sqlx::query(
        "INSERT INTO inventory (wallet_address, item_id, equipped, acquired_at)
         VALUES ($1, $2, false, now())
         ON CONFLICT (wallet_address, item_id) DO NOTHING",
    )
    .bind(&wallet)
    .bind(body.item_id)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => HttpResponse::Ok().json(json!({"success": true})),
        Err(e) => {
            tracing::error!("Failed to add inventory item: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── PATCH /players/:wallet/inventory/:item_id ─────────────────────────────────
#[derive(Deserialize)]
pub struct EquipTogglePath {
    pub wallet:  String,
    pub item_id: Uuid,
}

#[derive(Deserialize)]
pub struct EquipToggleRequest {
    pub equipped: bool,
}

pub async fn toggle_equip(
    state: web::Data<AppState>,
    path: web::Path<EquipTogglePath>,
    body: web::Json<EquipToggleRequest>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.wallet);

    let result = sqlx::query(
        "UPDATE inventory SET equipped = $1
         WHERE wallet_address = $2 AND item_id = $3",
    )
    .bind(body.equipped)
    .bind(&wallet)
    .bind(path.item_id)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => HttpResponse::Ok().json(json!({"success": true})),
        Err(e) => {
            tracing::error!("Failed to toggle equip: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /players/:wallet/battles ──────────────────────────────────────────────
pub async fn get_battles(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    #[derive(serde::Serialize, sqlx::FromRow)]
    struct BattleRow {
        id:                    Uuid,
        challenger_wallet:     String,
        opponent_wallet:       String,
        winner_wallet:         String,
        xp_awarded_challenger: i32,
        xp_awarded_opponent:   i32,
        is_bot:                bool,
        created_at:            chrono::DateTime<Utc>,
    }

    let result = sqlx::query_as::<_, BattleRow>(
        "SELECT id, challenger_wallet, opponent_wallet, winner_wallet,
                xp_awarded_challenger, xp_awarded_opponent, is_bot, created_at
         FROM battles
         WHERE challenger_wallet = $1 OR opponent_wallet = $1
         ORDER BY created_at DESC
         LIMIT 20",
    )
    .bind(&wallet)
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => {
            tracing::error!("Failed to fetch battles: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── GET /players/:wallet/daily-claim-status ───────────────────────────────────
pub async fn daily_claim_status(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();

    let result: Option<(chrono::DateTime<Utc>,)> = sqlx::query_as(
        "SELECT last_claimed_at FROM daily_claims WHERE wallet_address = $1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    match result {
        Some((last_claimed_at,)) => {
            let next_claim_at = last_claimed_at + chrono::Duration::hours(24);
            let can_claim = Utc::now() >= next_claim_at;
            HttpResponse::Ok().json(json!({
                "last_claimed_at": last_claimed_at,
                "next_claim_at": next_claim_at,
                "can_claim": can_claim,
            }))
        }
        None => HttpResponse::Ok().json(json!({ "can_claim": true })),
    }
}

// ── GET /players/search?q=:query ─────────────────────────────────────────────
#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub exclude: Option<String>,
}

pub async fn search_players(
    state: web::Data<AppState>,
    query: web::Query<SearchQuery>,
) -> HttpResponse {
    let q       = format!("%{}%", query.q.to_lowercase());
    let exclude = query.exclude.as_deref().unwrap_or("");

    let result = sqlx::query_as::<_, crate::models::player::Player>(
        "SELECT * FROM players
         WHERE (LOWER(character_name) LIKE $1 OR LOWER(COALESCE(username,'')) LIKE $1)
           AND wallet_address != $2
         LIMIT 5",
    )
    .bind(&q)
    .bind(exclude)
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(players) => HttpResponse::Ok().json(players),
        Err(e) => {
            tracing::error!("Search failed: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Search failed"}))
        }
    }
}

// ── GET /players/:wallet/achievements ─────────────────────────────────────────
pub async fn get_achievements(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();

    #[derive(serde::Serialize, sqlx::FromRow)]
    struct AchievementRow {
        achievement_id: uuid::Uuid,
        name:           String,
        description:    String,
        image_url:      String,
        unlocked_at:    chrono::DateTime<Utc>,
    }

    let result = sqlx::query_as::<_, AchievementRow>(
        "SELECT pa.achievement_id, a.name, a.description, a.image_url, pa.unlocked_at
         FROM player_achievements pa
         JOIN achievements a ON a.id = pa.achievement_id
         WHERE pa.wallet_address = $1
         ORDER BY pa.unlocked_at DESC
         LIMIT 6",
    )
    .bind(&wallet)
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => {
            tracing::error!("Failed to fetch achievements: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── POST /players/:wallet/achievements/check ──────────────────────────────────
pub async fn check_achievements(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = path.into_inner();

    #[derive(serde::Serialize, sqlx::FromRow)]
    struct NewAchievement {
        achievement_id:   uuid::Uuid,
        achievement_name: String,
        unlocked_at:      chrono::DateTime<Utc>,
    }

    let result = sqlx::query_as::<_, NewAchievement>(
        "SELECT * FROM check_and_unlock_achievements($1)",
    )
    .bind(&wallet)
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => {
            tracing::error!("Failed to check achievements: {}", e);
            HttpResponse::InternalServerError().json(json!({"error": "Database error"}))
        }
    }
}

// ── POST /players/:wallet/freeze-decay ───────────────────────────────────────
// Requires the player to own at least one shield category item.
// Consumes one shield, then freezes decay for 7 days.
pub async fn freeze_decay(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet = normalize_wallet(&path.into_inner());

    // Find the first owned shield item
    let shield: Option<(Uuid,)> = sqlx::query_as(
        "SELECT inventory.item_id FROM inventory
         JOIN items ON inventory.item_id = items.id
         WHERE inventory.wallet_address = $1 AND items.category = 'shield'
         LIMIT 1",
    )
    .bind(&wallet)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let Some((shield_item_id,)) = shield else {
        return HttpResponse::UnprocessableEntity()
            .json(json!({"error": "No Protection Shield in inventory"}));
    };

    // Consume the shield
    let _ = sqlx::query(
        "DELETE FROM inventory WHERE wallet_address = $1 AND item_id = $2",
    )
    .bind(&wallet)
    .bind(shield_item_id)
    .execute(&state.db)
    .await;

    let frozen_until = Utc::now() + chrono::Duration::days(7);

    let _ = sqlx::query(
        "UPDATE players
         SET decay_frozen_until = $1, decay_status = 'none'
         WHERE wallet_address = $2",
    )
    .bind(frozen_until)
    .bind(&wallet)
    .execute(&state.db)
    .await;

    HttpResponse::Ok().json(json!({
        "frozen_until":   frozen_until.to_rfc3339(),
        "shield_item_id": shield_item_id.to_string(),
    }))
}
