//! Face-Off — real-time head-to-head PvP arena, server-authoritative combat.
//!
//! Modeled on `game_server.rs`'s actor/channel pattern (one long-lived task,
//! one `mpsc` inbox, a room map), but two things differ on purpose:
//!
//!   - Pairing is by `duel_id`, not an anonymous FIFO queue. A Face-Off match
//!     only exists because a `duels` row with `mode = 'face_off'` was already
//!     created and accepted (stakes already escrowed via the normal duels
//!     flow) — this actor's job is to referee the live fight, not to matchmake
//!     strangers. Each `duel_id` pairs exactly the two wallets already on that
//!     row; `arena_ws.rs` checks that before ever sending a `Join` here.
//!
//!   - It runs a fixed-interval `Tick` that integrates real simulation state —
//!     movement, aim, shooting — for both players every tick, unlike
//!     `game_server.rs`'s purely event-driven "attack/block/special" resolver.
//!
//! SERVER AUTHORITY, THE POINT OF THIS FILE: nothing a client sends is ever
//! applied directly. A client's `Input` is a *request* (`InputSample`) —
//! "I want to move this way, I want to look this way, I'm holding fire" — and
//! every tick integrates that request under server-owned bounds: movement is
//! clamped to the arena, aim can only turn at a bounded rate (a client cannot
//! make its aim teleport onto a target), fire rate/ammo/reload are tracked
//! server-side, and a hit is only real if the server's own raycast — against
//! the server's own idea of where the target is standing — confirms it. This
//! is what `apps/web/src/engine/fps/FpsSim.ts` cannot do today: it resolves
//! shooting, but trusts whatever eye position/aim direction the client hands
//! it, which is fine for AI enemies and not fine when the "enemy" is another
//! human with G$ on the line.
//!
//! V1 SCOPE, DELIBERATELY NARROW: one fixed weapon/loadout, one small
//! symmetric rectangular arena (no interior cover — an axis-bound clamp is
//! today's whole "collision"), two hitbox zones (head sphere + one body box,
//! not FpsSim's five), no ADS/crouch/attachments/crit. Tuned constants below
//! are a first pass, not a balance pass.

use std::collections::HashMap;
use std::f32::consts::{PI, TAU};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{self, UnboundedSender};
use uuid::Uuid;
use serde_json::json;
use sqlx::PgPool;

use crate::AppState;
use crate::handlers::{battles, duels};

// ── Public handle — cheaply cloneable, passed into AppState ──────────────────

#[derive(Clone)]
pub struct ArenaServerHandle {
    pub tx: UnboundedSender<ServerMsg>,
}

impl ArenaServerHandle {
    /// `app_state` is empty at spawn time (see main.rs) and set once AppState
    /// itself is fully built — the match-end settlement path needs a real
    /// AppState to call `duels::resolve_live_duel`/`battles::award_player`,
    /// but this actor necessarily starts running before AppState can exist.
    pub fn spawn(db: PgPool, app_state: Arc<OnceLock<AppState>>) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let self_tx = tx.clone();
        tokio::spawn(ArenaServer::new(db, app_state).run(rx, self_tx.clone()));

        // Drives the fixed tick independently of client traffic — a room with
        // both players silently AFK still needs to keep ticking so the match
        // timeout can fire.
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(TICK_INTERVAL);
            loop {
                interval.tick().await;
                if self_tx.send(ServerMsg::Tick).is_err() {
                    break; // server task gone
                }
            }
        });

        Self { tx }
    }
}

/// 20Hz: frequent enough that movement/aim/shots feel responsive over a WS
/// round-trip, cheap enough for one actor to step every room serially. First
/// pass — raise it later if the feel demands it.
const TICK_INTERVAL: Duration = Duration::from_millis(50);

// ── Arena tuning — a small hand-built symmetric box, one fixed loadout ───────

const ARENA_HALF_X: f32 = 12.0;
const ARENA_HALF_Z: f32 = 12.0;
/// Matches `WALK` in `ValorScene.tsx` — same walk speed as everywhere else in
/// the game, so Face-Off doesn't feel like a different engine.
const WALK_SPEED: f32 = 3.4;
const EYE_HEIGHT: f32 = 1.6;
/// Matches `PITCH_LIMIT` in `ValorScene.tsx`.
const PITCH_LIMIT: f32 = 1.45;
/// Bounded turn rate is the actual anti-aimbot mechanism: a client can *ask*
/// to look anywhere, but the server only ever lets aim get there at this
/// angular speed — a full 180° flick still takes a little over a tenth of a
/// second, not one packet. First-pass number, tune once this is playable.
const MAX_YAW_RATE: f32 = 20.0; // rad/s
const MAX_PITCH_RATE: f32 = 20.0; // rad/s

const MAX_HP: i32 = 100;
const HEAD_RADIUS: f32 = 0.18;
const BODY_HALF_X: f32 = 0.35;
const BODY_HALF_Z: f32 = 0.35;
const BODY_MIN_Y: f32 = 0.2;
const BODY_MAX_Y: f32 = 1.5;

const FIRE_INTERVAL: Duration = Duration::from_millis(100); // 600 rpm
const MAG_SIZE: i32 = 30;
const RELOAD_SECS: f32 = 2.0;
const DAMAGE_BODY: i32 = 20;
const DAMAGE_HEAD: i32 = 45;
/// Half-angle of the hitscan spread cone, in radians — a shot's true
/// direction is the server-owned aim jittered within this cone, drawn from
/// the room's seeded RNG rather than `Math.random`, so a disputed shot
/// sequence is reproducible from the seed.
const SPREAD_HALF_ANGLE: f32 = 0.02;

/// Safety net so a match can't hang forever if both players go idle mid-fight
/// without disconnecting. Higher HP wins; an exact tie is a draw.
const MATCH_TIMEOUT: Duration = Duration::from_secs(180);

/// Flat XP, matching the numbers the old turn-based Live PvP already used —
/// not a new balance decision, just carried over.
const FACE_OFF_XP_WIN: i32 = 100;
const FACE_OFF_XP_LOSS: i32 = 30;

// ── Messages flowing into the arena server task ───────────────────────────────

pub struct ClientEntry {
    pub duel_id: Uuid,
    pub wallet: String,
    pub name: String,
    pub stake_g: i64,
    pub tx: UnboundedSender<String>,
}

/// Raw per-frame input a client sends. This is a REQUEST, never applied
/// directly — see the module doc. `yaw`/`pitch` are the client's camera
/// orientation; the server only ever steps its own aim state toward these at
/// a bounded rate.
#[derive(Clone, Copy, Default)]
pub struct InputSample {
    pub move_x: f32,
    pub move_y: f32,
    pub yaw: f32,
    pub pitch: f32,
    pub firing: bool,
    pub want_reload: bool,
}

pub enum ServerMsg {
    Join(ClientEntry),
    Input { wallet: String, sample: InputSample },
    Leave { wallet: String },
    FightStart { room_id: String },
    Tick,
}

// ── Internal state ────────────────────────────────────────────────────────────

struct PlayerState {
    wallet: String,
    #[allow(dead_code)] // surfaced to the client once a name/avatar UI exists
    name: String,
    stake_g: i64,
    tx: UnboundedSender<String>,

    // Server-owned spatial state. `last_input` is the client's most recent
    // desired input; every Tick integrates toward it under the caps in the
    // tuning block above — this struct never holds a client-dictated value
    // directly.
    x: f32,
    z: f32,
    yaw: f32,
    pitch: f32,
    hp: i32,
    alive: bool,

    ammo: i32,
    reloading: bool,
    reload_ends_at: Option<Instant>,
    next_shot_at: Instant,

    last_input: InputSample,
}

impl PlayerState {
    fn spawn(wallet: String, name: String, stake_g: i64, tx: UnboundedSender<String>, x: f32, yaw: f32) -> Self {
        Self {
            wallet, name, stake_g, tx,
            x, z: 0.0, yaw, pitch: 0.0, hp: MAX_HP, alive: true,
            ammo: MAG_SIZE, reloading: false, reload_ends_at: None,
            next_shot_at: Instant::now(),
            last_input: InputSample::default(),
        }
    }
}

struct ArenaRoom {
    duel_id: Uuid,
    p1: PlayerState,
    p2: PlayerState,
    started: Instant,
    active: bool,
    rng: Rng,
}

struct ArenaServer {
    // One waiting slot per duel_id — the first player to join sits here until
    // the second arrives (or leaves before they do).
    waiting: HashMap<Uuid, ClientEntry>,
    rooms: HashMap<String, ArenaRoom>,
    player_rooms: HashMap<String, String>,
    #[allow(dead_code)] // reserved — nothing here persists directly through `db` yet
    db: PgPool,
    app_state: Arc<OnceLock<AppState>>,
}

impl ArenaServer {
    fn new(db: PgPool, app_state: Arc<OnceLock<AppState>>) -> Self {
        Self {
            waiting: HashMap::new(),
            rooms: HashMap::new(),
            player_rooms: HashMap::new(),
            db,
            app_state,
        }
    }

    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<ServerMsg>, self_tx: UnboundedSender<ServerMsg>) {
        while let Some(msg) = rx.recv().await {
            self.handle(msg, &self_tx);
        }
    }

    fn handle(&mut self, msg: ServerMsg, self_tx: &UnboundedSender<ServerMsg>) {
        match msg {
            ServerMsg::Join(entry) => self.on_join(entry, self_tx),
            ServerMsg::Input { wallet, sample } => self.on_input(&wallet, sample),
            ServerMsg::Leave { wallet } => self.on_leave(&wallet),
            ServerMsg::FightStart { room_id } => self.fight_start(&room_id),
            ServerMsg::Tick => self.on_tick(),
        }
    }

    // ── Join / pairing ────────────────────────────────────────────────────────

    fn on_join(&mut self, entry: ClientEntry, self_tx: &UnboundedSender<ServerMsg>) {
        // Already in a room (e.g. a stray reconnect) — ignore rather than
        // double-seat them.
        if self.player_rooms.contains_key(&entry.wallet) {
            return;
        }

        match self.waiting.remove(&entry.duel_id) {
            Some(first) => self.create_room(first, entry, self_tx),
            None => {
                tracing::info!("arena: {} waiting alone on duel {}", entry.wallet, entry.duel_id);
                send(&entry.tx, json!({ "type": "waiting_for_opponent" }));
                self.waiting.insert(entry.duel_id, entry);
            }
        }
    }

    fn create_room(&mut self, e1: ClientEntry, e2: ClientEntry, self_tx: &UnboundedSender<ServerMsg>) {
        let room_id = e1.duel_id.to_string();
        tracing::info!("arena: paired {} vs {} on duel {}", e1.wallet, e2.wallet, e1.duel_id);

        send(&e1.tx, json!({
            "type": "match_found",
            "opponent": { "wallet": e2.wallet, "name": e2.name },
            "countdown": 3,
        }));
        send(&e2.tx, json!({
            "type": "match_found",
            "opponent": { "wallet": e1.wallet, "name": e1.name },
            "countdown": 3,
        }));

        self.player_rooms.insert(e1.wallet.clone(), room_id.clone());
        self.player_rooms.insert(e2.wallet.clone(), room_id.clone());

        // Spawned facing each other from opposite ends of the arena.
        let p1 = PlayerState::spawn(e1.wallet, e1.name, e1.stake_g, e1.tx, -ARENA_HALF_X * 0.6, 0.0);
        let p2 = PlayerState::spawn(e2.wallet, e2.name, e2.stake_g, e2.tx, ARENA_HALF_X * 0.6, PI);

        self.rooms.insert(room_id.clone(), ArenaRoom {
            duel_id: e1.duel_id,
            p1, p2,
            started: Instant::now(),
            active: false,
            rng: Rng::new(rand_seed()),
        });

        let stx = self_tx.clone();
        let rid = room_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let _ = stx.send(ServerMsg::FightStart { room_id: rid });
        });
    }

    fn fight_start(&mut self, room_id: &str) {
        if let Some(room) = self.rooms.get_mut(room_id) {
            room.active = true;
            room.started = Instant::now();
            let msg = json!({ "type": "fight_start" }).to_string();
            let _ = room.p1.tx.send(msg.clone());
            let _ = room.p2.tx.send(msg);
        }
    }

    // ── Input ─────────────────────────────────────────────────────────────────

    fn on_input(&mut self, wallet: &str, sample: InputSample) {
        let room_id = match self.player_rooms.get(wallet) {
            Some(id) => id.clone(),
            None => return,
        };
        let room = match self.rooms.get_mut(&room_id) {
            Some(r) if r.active => r,
            _ => return,
        };
        let p = if room.p1.wallet == wallet { &mut room.p1 } else { &mut room.p2 };
        p.last_input = sample;
    }

    // ── Tick — the whole simulation step ─────────────────────────────────────

    fn on_tick(&mut self) {
        let dt = TICK_INTERVAL.as_secs_f32();
        let room_ids: Vec<String> = self.rooms.keys().cloned().collect();

        for room_id in room_ids {
            let mut ended: Option<MatchEndInfo> = None;
            let mut hit_events: Vec<HitEvent> = Vec::new();

            if let Some(room) = self.rooms.get_mut(&room_id) {
                if !room.active {
                    continue;
                }

                integrate_movement_and_aim(&mut room.p1, dt);
                integrate_movement_and_aim(&mut room.p2, dt);

                // Reborrow so p1/p2/rng can be held mutably at once — this is
                // exactly what needs both sides live simultaneously (a shot
                // reads the shooter's aim AND writes the target's HP).
                let ArenaRoom { p1, p2, rng, .. } = &mut *room;
                if let Some(ev) = try_fire(rng, p1, p2) { hit_events.push(ev); }
                if let Some(ev) = try_fire(rng, p2, p1) { hit_events.push(ev); }

                let timed_out = room.started.elapsed() >= MATCH_TIMEOUT;
                if !room.p1.alive || !room.p2.alive || timed_out {
                    room.active = false;
                    let winner_wallet = if !room.p1.alive && !room.p2.alive {
                        None // simultaneous kill this tick
                    } else if !room.p1.alive {
                        Some(room.p2.wallet.clone())
                    } else if !room.p2.alive {
                        Some(room.p1.wallet.clone())
                    } else {
                        use std::cmp::Ordering;
                        match room.p1.hp.cmp(&room.p2.hp) {
                            Ordering::Greater => Some(room.p1.wallet.clone()),
                            Ordering::Less => Some(room.p2.wallet.clone()),
                            Ordering::Equal => None,
                        }
                    };
                    ended = Some(MatchEndInfo {
                        duel_id: room.duel_id,
                        p1_wallet: room.p1.wallet.clone(),
                        p2_wallet: room.p2.wallet.clone(),
                        winner_wallet,
                        reason: if timed_out { "timeout" } else { "hp_zero" },
                    });
                }

                // hit_confirm first so a kill's final state_update (hp: 0)
                // lands right after the shot that caused it.
                for ev in &hit_events {
                    let payload = json!({
                        "type": "hit_confirm",
                        "shooter": ev.shooter, "target": ev.target,
                        "part": match ev.part { HitPart::Head => "head", HitPart::Body => "body" },
                        "damage": ev.damage, "target_hp": ev.target_hp,
                    }).to_string();
                    let _ = room.p1.tx.send(payload.clone());
                    let _ = room.p2.tx.send(payload);
                }

                let state_payload = json!({
                    "type": "state_update",
                    "players": [player_json(&room.p1), player_json(&room.p2)],
                }).to_string();
                let _ = room.p1.tx.send(state_payload.clone());
                let _ = room.p2.tx.send(state_payload);
            }

            if let Some(info) = ended {
                self.end_room(&room_id, info);
            }
        }
    }

    // ── Disconnect ────────────────────────────────────────────────────────────

    fn on_leave(&mut self, wallet: &str) {
        // Not yet paired — just drop the waiting slot if it's theirs.
        let was_waiting = self.waiting.iter().any(|(_, e)| e.wallet == wallet);
        self.waiting.retain(|_, e| e.wallet != wallet);
        if was_waiting {
            tracing::info!("arena: {} left the waiting slot before anyone joined", wallet);
        }

        let room_id = match self.player_rooms.get(wallet) {
            Some(id) => id.clone(),
            None => return,
        };
        let other_tx = match self.rooms.get(&room_id) {
            Some(r) => {
                if r.p1.wallet == wallet { r.p2.tx.clone() } else { r.p1.tx.clone() }
            }
            None => return,
        };

        tracing::info!("arena: {} disconnected mid-match from room {} — tearing it down unsettled", wallet, room_id);
        send(&other_tx, json!({ "type": "opponent_disconnected" }));
        if let Some(room) = self.rooms.remove(&room_id) {
            self.player_rooms.remove(&room.p1.wallet);
            self.player_rooms.remove(&room.p2.wallet);
            // TODO: a disconnect mid-fight should settle the stake (probably
            // a forfeit-win for whoever stayed) via duels::resolve_live_duel,
            // the same way end_room() does on a clean finish. Left as a hard
            // room-teardown with no settlement for now — a deliberate gap,
            // not an oversight (see Phase 5 in the plan: AFK/leaver handling).
            // Recoverable in the meantime via POST /admin/duels/{id}/void.
            let _ = room.duel_id;
        }
    }

    // ── End of match ──────────────────────────────────────────────────────────

    fn end_room(&mut self, room_id: &str, info: MatchEndInfo) {
        let room = match self.rooms.remove(room_id) {
            Some(r) => r,
            None => return,
        };
        tracing::info!(
            "arena: match ended for duel {} — winner={:?} reason={}",
            info.duel_id, info.winner_wallet, info.reason,
        );
        self.player_rooms.remove(&room.p1.wallet);
        self.player_rooms.remove(&room.p2.wallet);

        let is_draw = info.winner_wallet.is_none();
        let mk = |me: &str| json!({
            "type": "match_end",
            "result": if is_draw { "draw" } else if info.winner_wallet.as_deref() == Some(me) { "win" } else { "loss" },
            "reason": info.reason,
        }).to_string();
        let _ = room.p1.tx.send(mk(&room.p1.wallet));
        let _ = room.p2.tx.send(mk(&room.p2.wallet));

        match self.app_state.get() {
            Some(state) => {
                let state = state.clone();
                tokio::spawn(settle_face_off_match(state, info));
            }
            None => {
                // Should be unreachable in practice — the cell is set right
                // after AppState is built, strictly before the API starts
                // accepting /ws/arena connections at all — but fail loudly
                // rather than silently stranding a stake if it ever happens.
                tracing::error!(
                    "arena match {} ended before AppState was wired up — stake/XP NOT settled",
                    info.duel_id,
                );
            }
        }
    }
}

/// Everything the async settlement task needs, captured before the room (and
/// its non-Send `UnboundedSender`-holding PlayerStates) is dropped.
struct MatchEndInfo {
    duel_id: Uuid,
    p1_wallet: String,
    p2_wallet: String,
    /// None = draw.
    winner_wallet: Option<String>,
    reason: &'static str,
}

/// Pays the stake and awards XP/rank through the exact same functions HTTP
/// handlers use for every other mode — `duels::resolve_live_duel` reuses
/// `settle_win`/`settle_draw` (same house cut, same on-chain idempotency as
/// `wave_race`), and `battles::award_player`/`persist_battle` are the shared
/// building blocks other fight modes already call (their outer wrapper,
/// `finalize_fight`, is PvE-shaped — it hardcodes the opponent as `"bot"` —
/// so this calls the two pieces it's built from directly instead).
async fn settle_face_off_match(app_state: AppState, info: MatchEndInfo) {
    let is_draw = info.winner_wallet.is_none();

    let _ = duels::resolve_live_duel(&app_state, info.duel_id, info.winner_wallet.as_deref()).await;

    let p1_won = !is_draw && info.winner_wallet.as_deref() == Some(info.p1_wallet.as_str());
    let p2_won = !is_draw && info.winner_wallet.as_deref() == Some(info.p2_wallet.as_str());
    let mult1 = battles::equipped_xp_multiplier(&app_state.db, &info.p1_wallet).await;
    let mult2 = battles::equipped_xp_multiplier(&app_state.db, &info.p2_wallet).await;
    let base1 = if p1_won { FACE_OFF_XP_WIN } else { FACE_OFF_XP_LOSS };
    let base2 = if p2_won { FACE_OFF_XP_WIN } else { FACE_OFF_XP_LOSS };

    // A draw doesn't add a loss to either player's W/L tally — same reasoning
    // count_result already uses for Endless waves: only a decisive result
    // "counts" as a win or a loss.
    //
    // Converted to Option immediately: `HttpResponse`'s Err payload isn't
    // Send, and holding it across the next `.await` would make this whole
    // function's future non-Send, which tokio::spawn requires.
    let award1 = battles::award_player(&app_state, &info.p1_wallet, p1_won, base1, mult1, true, !is_draw).await
        .map_err(|_| tracing::error!("face-off award_player failed for {}", info.p1_wallet))
        .ok();
    let award2 = battles::award_player(&app_state, &info.p2_wallet, p2_won, base2, mult2, true, !is_draw).await
        .map_err(|_| tracing::error!("face-off award_player failed for {}", info.p2_wallet))
        .ok();

    // The `battles` table has no draw representation — every other mode
    // always has a winner. A draw here is rare (an exact-HP timeout tie), so
    // skipping the historical row rather than inventing a fake winner is the
    // honest choice; the stake is still refunded and both sides still get
    // participation XP above, only the battle-history row is skipped.
    if !is_draw {
        if let (Some(a1), Some(a2)) = (&award1, &award2) {
            let winner = info.winner_wallet.as_deref().unwrap_or(&info.p1_wallet);
            let battle_id = Uuid::new_v4();
            battles::persist_battle(
                &app_state, battle_id, &info.p1_wallet, &info.p2_wallet, winner,
                a1.xp_earned, a2.xp_earned, false, json!([]), true, "pvp", true,
            ).await;
        }
    }
}

fn player_json(p: &PlayerState) -> serde_json::Value {
    json!({
        "wallet": p.wallet, "x": p.x, "z": p.z, "yaw": p.yaw, "pitch": p.pitch,
        "hp": p.hp, "ammo": p.ammo, "reloading": p.reloading,
    })
}

// ── Simulation — movement, aim, shooting ──────────────────────────────────────

fn integrate_movement_and_aim(p: &mut PlayerState, dt: f32) {
    let input = p.last_input;

    // Aim: bounded turn-rate toward the client's requested look direction —
    // see MAX_YAW_RATE/MAX_PITCH_RATE above for why this, not a direct set,
    // is what makes aim server-authoritative.
    p.yaw = step_angle_toward(p.yaw, input.yaw, MAX_YAW_RATE * dt);
    let target_pitch = input.pitch.clamp(-PITCH_LIMIT, PITCH_LIMIT);
    p.pitch = step_toward(p.pitch, target_pitch, MAX_PITCH_RATE * dt).clamp(-PITCH_LIMIT, PITCH_LIMIT);

    // Movement: camera-relative WASD at a fixed walk speed — same "instant
    // velocity, no accel curve" feel ValorScene.tsx uses client-side, just
    // integrated here against the arena bounds instead of trusted outright.
    let raw_len = (input.move_x * input.move_x + input.move_y * input.move_y).sqrt();
    let (mx, my) = if raw_len > 1.0 { (input.move_x / raw_len, input.move_y / raw_len) } else { (input.move_x, input.move_y) };
    let (sy, cy) = p.yaw.sin_cos();
    let dir_x = sy * my + cy * mx;
    let dir_z = cy * my + (-sy) * mx;
    p.x = (p.x + dir_x * WALK_SPEED * dt).clamp(-ARENA_HALF_X, ARENA_HALF_X);
    p.z = (p.z + dir_z * WALK_SPEED * dt).clamp(-ARENA_HALF_Z, ARENA_HALF_Z);

    if p.reloading {
        if let Some(ends) = p.reload_ends_at {
            if Instant::now() >= ends {
                p.ammo = MAG_SIZE;
                p.reloading = false;
                p.reload_ends_at = None;
            }
        }
    } else if (input.want_reload || p.ammo == 0) && p.ammo < MAG_SIZE {
        p.reloading = true;
        p.reload_ends_at = Some(Instant::now() + Duration::from_secs_f32(RELOAD_SECS));
    }
}

fn step_toward(current: f32, target: f32, max_delta: f32) -> f32 {
    if target > current { (current + max_delta).min(target) } else { (current - max_delta).max(target) }
}

/// Like `step_toward`, but for an angle — takes the shortest way around the
/// circle rather than always turning positive.
fn step_angle_toward(current: f32, target: f32, max_delta: f32) -> f32 {
    let mut diff = (target - current) % TAU;
    if diff > PI { diff -= TAU; }
    if diff < -PI { diff += TAU; }
    current + diff.clamp(-max_delta, max_delta)
}

#[derive(Clone, Copy)]
enum HitPart { Head, Body }

struct HitEvent {
    shooter: String,
    target: String,
    part: HitPart,
    damage: i32,
    target_hp: i32,
}

fn aim_dir(yaw: f32, pitch: f32) -> (f32, f32, f32) {
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = pitch.sin_cos();
    (sy * cp, sp, cy * cp)
}

/// Full-auto while `firing` is held, gated by fire-rate cadence, ammo, and
/// reload state — same shape as `FpsSim.ts`'s cadence gate, just server-side.
/// Spread jitter is drawn from `rng` (the room's seeded PRNG), never
/// `Math.random`, so a shot is reproducible from the room's seed.
fn try_fire(rng: &mut Rng, shooter: &mut PlayerState, target: &mut PlayerState) -> Option<HitEvent> {
    if !shooter.last_input.firing || shooter.reloading || shooter.ammo <= 0 {
        return None;
    }
    let now = Instant::now();
    if now < shooter.next_shot_at {
        return None;
    }
    shooter.next_shot_at = now + FIRE_INTERVAL;
    shooter.ammo -= 1;

    if !target.alive {
        return None;
    }

    let jitter_yaw = (rng.next_f32() - 0.5) * 2.0 * SPREAD_HALF_ANGLE;
    let jitter_pitch = (rng.next_f32() - 0.5) * 2.0 * SPREAD_HALF_ANGLE;
    let origin = (shooter.x, EYE_HEIGHT, shooter.z);
    let dir = aim_dir(shooter.yaw + jitter_yaw, shooter.pitch + jitter_pitch);

    let part = resolve_shot(origin, dir, target)?;
    let damage = match part { HitPart::Head => DAMAGE_HEAD, HitPart::Body => DAMAGE_BODY };
    target.hp = (target.hp - damage).max(0);
    if target.hp == 0 {
        target.alive = false;
    }
    Some(HitEvent {
        shooter: shooter.wallet.clone(), target: target.wallet.clone(),
        part, damage, target_hp: target.hp,
    })
}

/// Nearest of the target's two hitboxes the ray crosses — a head sphere and
/// one body box, deliberately simpler than `FpsSim.ts`'s five-zone player
/// model (head/torso/legs/2×arms) for this first pass.
fn resolve_shot(origin: (f32, f32, f32), dir: (f32, f32, f32), target: &PlayerState) -> Option<HitPart> {
    let head_t = ray_sphere(origin, dir, (target.x, EYE_HEIGHT, target.z), HEAD_RADIUS);
    let body_min = (target.x - BODY_HALF_X, BODY_MIN_Y, target.z - BODY_HALF_Z);
    let body_max = (target.x + BODY_HALF_X, BODY_MAX_Y, target.z + BODY_HALF_Z);
    let body_t = ray_aabb(origin, dir, body_min, body_max);

    match (head_t, body_t) {
        (Some(ht), Some(bt)) => Some(if ht <= bt { HitPart::Head } else { HitPart::Body }),
        (Some(_), None) => Some(HitPart::Head),
        (None, Some(_)) => Some(HitPart::Body),
        (None, None) => None,
    }
}

/// `dir` must already be unit length — `aim_dir` guarantees that.
fn ray_sphere(o: (f32, f32, f32), d: (f32, f32, f32), c: (f32, f32, f32), r: f32) -> Option<f32> {
    let (ox, oy, oz) = (o.0 - c.0, o.1 - c.1, o.2 - c.2);
    let b = ox * d.0 + oy * d.1 + oz * d.2;
    let cc = ox * ox + oy * oy + oz * oz - r * r;
    let disc = b * b - cc;
    if disc < 0.0 {
        return None;
    }
    let sqrt_disc = disc.sqrt();
    let t = -b - sqrt_disc;
    if t >= 0.0 { return Some(t); }
    let t2 = -b + sqrt_disc;
    if t2 >= 0.0 { Some(t2) } else { None }
}

fn ray_aabb(o: (f32, f32, f32), d: (f32, f32, f32), mn: (f32, f32, f32), mx: (f32, f32, f32)) -> Option<f32> {
    let mut tmin = 0.0f32;
    let mut tmax = f32::INFINITY;
    let axes = [(o.0, d.0, mn.0, mx.0), (o.1, d.1, mn.1, mx.1), (o.2, d.2, mn.2, mx.2)];
    for (o_a, d_a, mn_a, mx_a) in axes {
        if d_a.abs() < 1e-6 {
            if o_a < mn_a || o_a > mx_a {
                return None;
            }
        } else {
            let t1 = (mn_a - o_a) / d_a;
            let t2 = (mx_a - o_a) / d_a;
            let (t1, t2) = if t1 > t2 { (t2, t1) } else { (t1, t2) };
            tmin = tmin.max(t1);
            tmax = tmax.min(t2);
            if tmin > tmax {
                return None;
            }
        }
    }
    Some(tmin)
}

/// A tiny xorshift64* PRNG — deterministic from a seed (unlike `Math.random`
/// / `rand::rng()`), which is what makes a room's shot sequence reproducible
/// from its seed if a payout is ever disputed. Not cryptographic; doesn't
/// need to be for spread jitter.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed | 1) // never zero — a zero state stays zero forever
    }

    fn next_f32(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        ((x >> 40) as f32) / ((1u64 << 24) as f32)
    }
}

fn rand_seed() -> u64 {
    use rand::Rng as _;
    rand::rng().random()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn send(tx: &UnboundedSender<String>, val: serde_json::Value) {
    let _ = tx.send(val.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    // `db`/`app_state` are unused by anything these tests exercise directly
    // (match-end settlement is exercised separately, see below) —
    // `connect_lazy` builds a pool without ever dialing out, so these tests
    // don't need a real Postgres instance.
    fn lazy_pool() -> PgPool {
        sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://test:test@localhost/test")
            .expect("lazy pool")
    }

    fn entry(duel_id: Uuid, wallet: &str) -> (ClientEntry, mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (ClientEntry { duel_id, wallet: wallet.into(), name: wallet.into(), stake_g: 500, tx }, rx)
    }

    async fn next_json(rx: &mut mpsc::UnboundedReceiver<String>) -> serde_json::Value {
        let raw = rx.recv().await.expect("expected a message on this channel");
        serde_json::from_str(&raw).expect("message wasn't valid JSON")
    }

    fn new_server() -> ArenaServer {
        ArenaServer::new(lazy_pool(), Arc::new(OnceLock::new()))
    }

    #[tokio::test]
    async fn first_joiner_waits_second_joiner_pairs_into_one_room() {
        let mut server = new_server();
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let duel_id = Uuid::new_v4();

        let (e1, mut rx1) = entry(duel_id, "0xAAA");
        server.on_join(e1, &self_tx);
        assert_eq!(next_json(&mut rx1).await["type"], "waiting_for_opponent");
        assert!(server.rooms.is_empty(), "one joiner shouldn't create a room yet");

        let (e2, mut rx2) = entry(duel_id, "0xBBB");
        server.on_join(e2, &self_tx);

        let found1 = next_json(&mut rx1).await;
        let found2 = next_json(&mut rx2).await;
        assert_eq!(found1["type"], "match_found");
        assert_eq!(found1["opponent"]["wallet"], "0xBBB");
        assert_eq!(found2["opponent"]["wallet"], "0xAAA");
        assert_eq!(server.rooms.len(), 1);
        assert_eq!(server.player_rooms.len(), 2);
    }

    async fn paired_and_fighting(server: &mut ArenaServer, duel_id: Uuid) -> (mpsc::UnboundedReceiver<String>, mpsc::UnboundedReceiver<String>) {
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let (e1, mut rx1) = entry(duel_id, "0xAAA");
        let (e2, mut rx2) = entry(duel_id, "0xBBB");
        server.on_join(e1, &self_tx);
        server.on_join(e2, &self_tx);
        let _ = next_json(&mut rx1).await; // waiting_for_opponent
        let _ = next_json(&mut rx1).await; // match_found
        let _ = next_json(&mut rx2).await; // match_found
        server.fight_start(&duel_id.to_string());
        let _ = next_json(&mut rx1).await; // fight_start
        let _ = next_json(&mut rx2).await; // fight_start
        (rx1, rx2)
    }

    #[tokio::test]
    async fn fight_start_then_tick_broadcasts_state_to_both_players() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, _rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_tick();
        let state1 = next_json(&mut rx1).await;
        assert_eq!(state1["type"], "state_update");
        let wallets: Vec<String> = state1["players"].as_array().unwrap()
            .iter().map(|p| p["wallet"].as_str().unwrap().to_string()).collect();
        assert_eq!(wallets, vec!["0xAAA", "0xBBB"]);
    }

    #[tokio::test]
    async fn walking_forward_moves_a_player_and_stays_inside_the_arena() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, _rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_input("0xAAA", InputSample { move_y: 1.0, ..Default::default() });
        let (x0, z0) = { let p = &server.rooms.get(&duel_id.to_string()).unwrap().p1; (p.x, p.z) };
        for _ in 0..10 {
            server.on_tick();
            let _ = next_json(&mut rx1).await;
        }
        let (x1, z1) = { let p = &server.rooms.get(&duel_id.to_string()).unwrap().p1; (p.x, p.z) };
        let moved = ((x1 - x0).powi(2) + (z1 - z0).powi(2)).sqrt();
        assert!(moved > 0.1, "10 ticks of forward input should have moved the player, moved {}", moved);
        assert!(x1.abs() <= ARENA_HALF_X && z1.abs() <= ARENA_HALF_Z, "player must stay inside the arena bounds");
    }

    #[tokio::test]
    async fn aim_turns_gradually_not_instantly_to_the_requested_yaw() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, _rx2) = paired_and_fighting(&mut server, duel_id).await;

        // Request a full 180-degree flip in one input sample.
        server.on_input("0xAAA", InputSample { yaw: PI, ..Default::default() });
        server.on_tick();
        let _ = next_json(&mut rx1).await;
        let yaw_after_one_tick = server.rooms.get(&duel_id.to_string()).unwrap().p1.yaw;

        // One 50ms tick at MAX_YAW_RATE=20 rad/s can turn at most 1.0 rad —
        // nowhere near the full PI (~3.14) requested, proving the server
        // clamps the turn rather than snapping straight to the target.
        assert!(
            yaw_after_one_tick.abs() < PI - 0.5,
            "aim must not snap instantly to the requested yaw in a single tick, got {}",
            yaw_after_one_tick,
        );
        assert!(yaw_after_one_tick.abs() > 0.0, "aim should still have turned SOME amount");
    }

    #[tokio::test]
    async fn a_point_blank_shot_at_the_stationary_opponent_lands_and_broadcasts_a_hit() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        // Pull p2 in close (1m) rather than firing across the full ~14.4m
        // arena: SPREAD_HALF_ANGLE's jitter is small in absolute terms but
        // scales with range, so a max-unlucky roll across the whole arena
        // can clear both hitboxes and make this test flaky. At 1m even the
        // worst-case jitter lands well inside both.
        {
            let room = server.rooms.get_mut(&duel_id.to_string()).unwrap();
            room.p2.x = room.p1.x + 1.0;
            room.p2.z = room.p1.z;
        }

        // Aim p1 dead at p2's (now nearby) position. Forward at yaw=0 is +Z (aim_dir's
        // convention: (sin(yaw), sin(pitch), cos(yaw)) at pitch=0 gives
        // (sin(yaw), 0, cos(yaw))) — both players spawn at z=0, p1 at -X and
        // p2 at +X, so facing p2 means yaw = PI/2 (forward = (1, 0, 0)).
        //
        // Set via input, not by poking room.p1.yaw directly: aim is
        // integration-driven (see MAX_YAW_RATE), so a directly-set yaw would
        // just get pulled back toward whatever the input's (default) target
        // is on the very next tick. Aim first, without firing, so aim has
        // fully arrived (MAX_YAW_RATE bounds how fast — see the turn-rate
        // test above) before any shot is fired, so no hit_confirm is missed
        // by being drained during this warm-up phase.
        server.on_input("0xAAA", InputSample { yaw: PI / 2.0, pitch: 0.0, ..Default::default() });
        for _ in 0..5 {
            server.on_tick();
            let _ = next_json(&mut rx1).await;
            let _ = next_json(&mut rx2).await;
        }
        server.on_input("0xAAA", InputSample { firing: true, yaw: PI / 2.0, pitch: 0.0, ..Default::default() });

        let mut saw_hit = false;
        for _ in 0..5 {
            server.on_tick();
            let msg = next_json(&mut rx1).await;
            let _ = next_json(&mut rx2).await;
            if msg["type"] == "hit_confirm" {
                assert_eq!(msg["shooter"], "0xAAA");
                assert_eq!(msg["target"], "0xBBB");
                saw_hit = true;
                let _state = next_json(&mut rx1).await; // the state_update that follows
                let _ = next_json(&mut rx2).await;
                break;
            }
        }
        assert!(saw_hit, "a point-blank shot at a stationary, correctly-aimed target should land within a few ticks");
    }

    #[tokio::test]
    async fn leaving_mid_fight_notifies_the_opponent_and_tears_the_room_down() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (_rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_leave("0xAAA");
        assert_eq!(next_json(&mut rx2).await["type"], "opponent_disconnected");
        assert!(server.rooms.is_empty());
        assert!(server.player_rooms.is_empty());
    }

    #[tokio::test]
    async fn a_stray_join_from_an_already_seated_wallet_is_ignored() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let (mut rx1, _rx2) = paired_and_fighting(&mut server, duel_id).await;
        let _ = &mut rx1; // already drained by paired_and_fighting; kept for clarity

        let (dupe, mut rx3) = entry(duel_id, "0xAAA");
        server.on_join(dupe, &self_tx);
        assert_eq!(server.rooms.len(), 1, "a reseat attempt must not spawn a second room");
        assert!(rx3.try_recv().is_err(), "the stray duplicate connection gets nothing");
    }

    // ── Pure geometry/math, no actor needed ──────────────────────────────────

    #[test]
    fn ray_sphere_hits_a_sphere_dead_ahead_and_misses_one_behind() {
        assert!(ray_sphere((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 0.0, 5.0), 0.5).is_some());
        assert!(ray_sphere((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 0.0, -5.0), 0.5).is_none());
        assert!(ray_sphere((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), (5.0, 0.0, 5.0), 0.5).is_none());
    }

    #[test]
    fn ray_aabb_hits_a_box_dead_ahead_and_misses_one_to_the_side() {
        assert!(ray_aabb((0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (-0.5, 0.5, 4.5), (0.5, 1.5, 5.5)).is_some());
        assert!(ray_aabb((0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (5.5, 0.5, 4.5), (6.5, 1.5, 5.5)).is_none());
    }

    #[test]
    fn step_angle_toward_takes_the_short_way_around_the_wrap() {
        // From just past -PI toward just past +PI, the short way is a tiny
        // step across the wrap, not almost a full turn the long way.
        let from = -PI + 0.05;
        let to = PI - 0.05;
        let stepped = step_angle_toward(from, to, 1.0);
        // Should have moved a small amount, not ~2*PI - 0.1.
        let delta = (stepped - from).abs();
        assert!(delta < 1.5, "expected a short step across the wrap, moved {}", delta);
    }

    #[test]
    fn rng_is_deterministic_from_its_seed() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..8 {
            assert_eq!(a.next_f32(), b.next_f32(), "same seed must produce the same sequence");
        }
    }
}
