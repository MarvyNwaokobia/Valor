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
//! ARENA GEOMETRY: one fixed, hand-picked room straight out of the real
//! Operation room generator (`apps/web/src/engine/fps/endless.ts`'s
//! `generateRoom`, seed `"valor-faceoff"`, room 0, CRATE_LINE cover
//! archetype) instead of an empty box — see `room_walls()`/`room_cover()`
//! below. Both this server and `ArenaScene.tsx` load the SAME
//! `faceoffArena.json` (embedded here at compile time via `include_str!`),
//! so there is one source of truth for the box list, not two hand-copied
//! arrays. `WALK_SPEED`/`ARENA_HALF_X`/`PITCH_LIMIT` and the rest of the
//! tuning block below are still mirrored by hand between the two files —
//! only the geometry itself moved to a shared file.
//!
//! V1 SCOPE, STILL DELIBERATELY NARROW: one fixed weapon/loadout (viewmodel
//! is cosmetic-only on the client and may be reskinned per player, but
//! stats never vary — staked real money, so both fighters get the same gun),
//! two hitbox zones (head sphere + one body box, not FpsSim's five), no
//! attachments/crit/leaning/sliding. Crouch and ADS ARE modeled (spread-only
//! — no server-side FOV/pose beyond hitbox height, that's cosmetic).

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

/// Outer safety-net bounds, kept as a fallback even though the real walls
/// (from `room_walls()`, via collide-and-slide — see `resolve_move`) do the
/// actual work now. Interior clear space is x in [-9,9], z in [-8.5,8.5] (the
/// real wall inner faces); inset by `PLAYER_RADIUS` so this clamp binds only
/// if the collision pass is ever wrong, not in ordinary play.
const ARENA_HALF_X: f32 = 8.6;
const ARENA_HALF_Z: f32 = 8.1;
/// Collision radius used against `room_walls()`/`room_cover()` — a human's
/// shoulder width, not a tuned hitbox.
const PLAYER_RADIUS: f32 = 0.35;
/// Matches `WALK` in `ValorScene.tsx` — same walk speed as everywhere else in
/// the game, so Face-Off doesn't feel like a different engine.
const WALK_SPEED: f32 = 3.4;
const EYE_HEIGHT: f32 = 1.6;
/// Matches `ValorScene.tsx`'s own `input.crouched ? 1.02 : 1.6` split.
const EYE_HEIGHT_CROUCH: f32 = 1.02;
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
/// Crouched target's body box top — dropped by the same 0.58m the eye height
/// drops (1.6 → 1.02), an approximation (the client's real 5-zone FpsSim
/// model has no single "crouched box height" to mirror exactly) but good
/// enough to make crouching behind cover actually shrink your profile.
const BODY_MAX_Y_CROUCH: f32 = 0.92;

const FIRE_INTERVAL: Duration = Duration::from_millis(100); // 600 rpm
const MAG_SIZE: i32 = 30;
const RELOAD_SECS: f32 = 2.0;
const DAMAGE_BODY: i32 = 20;
const DAMAGE_HEAD: i32 = 45;
/// Half-angle of the hitscan spread cone, in radians — a shot's true
/// direction is the server-owned aim jittered within this cone, drawn from
/// the room's seeded RNG rather than `Math.random`, so a disputed shot
/// sequence is reproducible from the seed. This is the HIP-FIRE baseline;
/// `ADS_SPREAD_MULT`/`CROUCH_SPREAD_MULT` narrow it further, same shape as
/// `FpsSim.ts`'s `spreadFor`.
const SPREAD_HALF_ANGLE: f32 = 0.02;
/// Matches `FPS_TUNING.ADS_SPREAD_MULT` in `FpsSim.ts`.
const ADS_SPREAD_MULT: f32 = 0.14;
/// Matches `FPS_TUNING.CROUCH_SPREAD_MULT` in `FpsSim.ts`.
const CROUCH_SPREAD_MULT: f32 = 0.7;

// ── Room geometry — ONE fixed Operation room, both ends sealed ───────────────
//
// Frozen output of `generateRoom(0, 0, seedFromString("valor-faceoff"))` in
// `apps/web/src/engine/fps/endless.ts` (CRATE_LINE cover archetype, depth
// 17), recentred so the room's midpoint sits at world origin (z was
// `zNear=0..zFar=-17`, shifted +8.5 so play space is symmetric around 0,0 —
// matches the ARENA_HALF_X/Z clamp convention above). The far wall's chain
// doorway is replaced with a solid cap (mirroring `entryCap`'s treatment of
// the near side) so this is one sealed room, not a corridor segment.
//
// Parsed once from `faceoffArena.json` — the same file `ArenaScene.tsx`
// imports directly — rather than a hand-copied literal, so the two can no
// longer silently drift apart.
struct Obstacle { x: f32, z: f32, hx: f32, hz: f32, h: f32 }

impl Obstacle {
    fn min(&self) -> (f32, f32, f32) { (self.x - self.hx, 0.0, self.z - self.hz) }
    fn max(&self) -> (f32, f32, f32) { (self.x + self.hx, self.h, self.z + self.hz) }
}

#[derive(serde::Deserialize)]
struct ObstacleData { x: f32, z: f32, w: f32, d: f32, h: f32 }

impl From<ObstacleData> for Obstacle {
    fn from(o: ObstacleData) -> Self {
        Self { x: o.x, z: o.z, hx: o.w / 2.0, hz: o.d / 2.0, h: o.h }
    }
}

#[derive(serde::Deserialize)]
struct ArenaGeometryFile { walls: Vec<ObstacleData>, cover: Vec<ObstacleData> }

const ARENA_GEOMETRY_JSON: &str = include_str!("../../../web/src/engine/scene/faceoffArena.json");

fn arena_geometry() -> &'static (Vec<Obstacle>, Vec<Obstacle>) {
    static GEOMETRY: OnceLock<(Vec<Obstacle>, Vec<Obstacle>)> = OnceLock::new();
    GEOMETRY.get_or_init(|| {
        let parsed: ArenaGeometryFile = serde_json::from_str(ARENA_GEOMETRY_JSON)
            .expect("faceoffArena.json must parse — it's checked in and shared with ArenaScene.tsx");
        (
            parsed.walls.into_iter().map(Obstacle::from).collect(),
            parsed.cover.into_iter().map(Obstacle::from).collect(),
        )
    })
}

fn room_walls() -> &'static [Obstacle] { &arena_geometry().0 }
fn room_cover() -> &'static [Obstacle] { &arena_geometry().1 }

/// Safety net so a match can't hang forever if both players go idle mid-fight
/// without disconnecting. Higher HP wins; an exact tie is a draw.
const MATCH_TIMEOUT: Duration = Duration::from_secs(180);

/// How long a room stays paused, waiting for a dropped wallet to reconnect,
/// before settling as a forfeit-loss for whoever never came back. This is the
/// actual fix for the 2026-08-23 stuck-duel incident: before this, ANY
/// disconnect tore the room down unsettled forever, recoverable only via
/// `POST /admin/duels/{id}/void`. Now a real network blip (the common case on
/// mobile) gets a fair window to reconnect into the SAME room and resume
/// exactly where it left off; only a wallet that never comes back within this
/// window loses the match, same as any other forfeit.
const RECONNECT_GRACE: Duration = Duration::from_secs(25);

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
    pub crouching: bool,
    pub ads: bool,
}

/// Combined wall + interior cover geometry, for the two things that need
/// "everything solid": movement collision and shot obstruction. Walls and
/// cover are kept as separate slices above only because `ArenaScene.tsx`
/// renders them with different materials.
fn obstacles() -> impl Iterator<Item = &'static Obstacle> {
    room_walls().iter().chain(room_cover().iter())
}

pub enum ServerMsg {
    Join(ClientEntry),
    Input { wallet: String, sample: InputSample },
    /// An accidental drop (network loss, tab killed, backgrounding) — distinct
    /// from `Forfeit`. Pauses the room and starts a `RECONNECT_GRACE` timer
    /// rather than ending the match; see `on_leave`.
    Leave { wallet: String },
    /// A deliberate "Exit" from the client, distinct from `Leave`. This one
    /// always settles immediately: the wallet forfeits, its opponent gets a
    /// real `match_end` win, same payout rails as any other finish.
    Forfeit { wallet: String },
    /// Fires `RECONNECT_GRACE` after a `Leave`, carrying the `Instant` that
    /// disconnect was recorded at. Only acts if the room is STILL waiting on
    /// that exact disconnect (i.e. `since` still matches) — a reconnect, or a
    /// second disconnect-then-reconnect cycle in between, invalidates it, so
    /// a stale timer is always a safe no-op rather than a race.
    GraceExpired { room_id: String, wallet: String, since: Instant },
    /// A read-only viewer for a live match — "anyone with the link", no
    /// wallet check the way `Join` has one. The room map itself is the
    /// access gate: a `duel_id` with no live room yet just gets told to
    /// try again, no DB round-trip needed the way Join needs one.
    Spectate { duel_id: Uuid, tx: UnboundedSender<String> },
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
    fn spawn(wallet: String, name: String, stake_g: i64, tx: UnboundedSender<String>, x: f32, z: f32, yaw: f32) -> Self {
        Self {
            wallet, name, stake_g, tx,
            x, z, yaw, pitch: 0.0, hp: MAX_HP, alive: true,
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
    /// Wallets currently disconnected, and when — empty means both sides are
    /// live. `on_tick` skips a room with `active == false`, which is how a
    /// pause actually freezes HP/position instead of just hiding the fact.
    disconnected: HashMap<String, Instant>,
    /// Read-only viewers. Never receive `Input` capability — a spectate
    /// connection has no `wallet` in `arena_ws.rs`, so even a malicious
    /// client sending an `Input` frame on this socket is a no-op (`on_input`
    /// only ever looks up a wallet in `player_rooms`, which spectators are
    /// never added to). Dead senders (a viewer who left) are never swept —
    /// a room's lifetime is one match, a few minutes at most, so a stale
    /// entry just sits harmlessly until the room itself is dropped.
    spectators: Vec<UnboundedSender<String>>,
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
            ServerMsg::Leave { wallet } => self.on_leave(&wallet, self_tx),
            ServerMsg::Forfeit { wallet } => self.on_forfeit(&wallet),
            ServerMsg::GraceExpired { room_id, wallet, since } => self.on_grace_expired(&room_id, &wallet, since),
            ServerMsg::Spectate { duel_id, tx } => self.on_spectate(duel_id, tx),
            ServerMsg::FightStart { room_id } => self.fight_start(&room_id),
            ServerMsg::Tick => self.on_tick(),
        }
    }

    // ── Join / pairing ────────────────────────────────────────────────────────

    fn on_join(&mut self, entry: ClientEntry, self_tx: &UnboundedSender<ServerMsg>) {
        // Already seated somewhere. Two cases: a genuine reconnect (the room
        // has this exact wallet marked disconnected — `on_leave` left the
        // player_rooms entry in place for exactly this) or a stray duplicate
        // join from a wallet that's already live — ignore that one rather
        // than double-seat them.
        if let Some(room_id) = self.player_rooms.get(&entry.wallet).cloned() {
            let is_reconnect = self.rooms.get(&room_id)
                .is_some_and(|r| r.disconnected.contains_key(&entry.wallet));
            if is_reconnect {
                self.reconnect(&room_id, entry);
            }
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

        // Spawned facing each other from opposite ends of the real room, just
        // inside each sealed cap — same 1.5m standoff `spawnPointFor` uses for
        // a chain room's entry point. yaw=0.0 at z=7.3 (and yaw=PI at z=-7.3)
        // face INTO the room, away from the cap immediately behind — verified
        // against `ArenaScene.tsx`'s camera rendering, not assumed from the
        // aim_dir formula alone (empirically the two are opposite of what a
        // naive reading of aim_dir suggests — see that file's spawn comment).
        let p1 = PlayerState::spawn(e1.wallet, e1.name, e1.stake_g, e1.tx, 0.0, 7.3, 0.0);
        let p2 = PlayerState::spawn(e2.wallet, e2.name, e2.stake_g, e2.tx, 0.0, -7.3, PI);

        self.rooms.insert(room_id.clone(), ArenaRoom {
            duel_id: e1.duel_id,
            p1, p2,
            started: Instant::now(),
            active: false,
            rng: Rng::new(rand_seed()),
            disconnected: HashMap::new(),
            spectators: Vec::new(),
        });

        let stx = self_tx.clone();
        let rid = room_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let _ = stx.send(ServerMsg::FightStart { room_id: rid });
        });
    }

    /// A wallet the room still has marked disconnected has come back on a
    /// fresh socket — reseat them onto the SAME `PlayerState` (position, HP,
    /// ammo, everything survives) rather than starting a new one, and resume
    /// ticking once BOTH sides are present again (handles the rare case where
    /// both players dropped and only one has come back so far).
    fn reconnect(&mut self, room_id: &str, entry: ClientEntry) {
        let Some(room) = self.rooms.get_mut(room_id) else { return };
        room.disconnected.remove(&entry.wallet);

        let p = if room.p1.wallet == entry.wallet { &mut room.p1 } else { &mut room.p2 };
        p.tx = entry.tx.clone();
        // Don't replay whatever input was in flight the instant they dropped
        // (e.g. still "firing") — they get one clean tick to get their
        // bearings before the sim acts on anything again.
        p.last_input = InputSample::default();

        let resumed = room.disconnected.is_empty();
        if resumed {
            room.active = true;
        }
        self.player_rooms.insert(entry.wallet.clone(), room_id.to_string());

        tracing::info!("arena: {} reconnected to room {} (resumed={})", entry.wallet, room_id, resumed);

        send(&entry.tx, json!({
            "type": "reconnected",
            "resumed": resumed,
            "players": [player_json(&room.p1), player_json(&room.p2)],
        }));
        if resumed {
            let other_tx = if room.p1.wallet == entry.wallet { room.p2.tx.clone() } else { room.p1.tx.clone() };
            send(&other_tx, json!({ "type": "opponent_reconnected" }));
        }
    }

    fn fight_start(&mut self, room_id: &str) {
        if let Some(room) = self.rooms.get_mut(room_id) {
            room.active = true;
            room.started = Instant::now();
            let msg = json!({ "type": "fight_start" }).to_string();
            let _ = room.p1.tx.send(msg.clone());
            let _ = room.p2.tx.send(msg.clone());
            broadcast_to_spectators(room, &msg);
        }
    }

    /// A viewer asking to watch a live match. No wallet check the way `Join`
    /// has one — "anyone with the link" was the deliberate scope here. If
    /// the room hasn't formed yet (still in matchmaking, or the duel_id is
    /// bogus), they're told to try again rather than left queued — see
    /// `ServerMsg::Spectate`'s doc for why no DB round-trip is needed either
    /// way.
    fn on_spectate(&mut self, duel_id: Uuid, tx: UnboundedSender<String>) {
        let room_id = duel_id.to_string();
        match self.rooms.get_mut(&room_id) {
            Some(room) => {
                send(&tx, json!({
                    "type": "spectate_joined",
                    "active": room.active,
                    "players": [player_json(&room.p1), player_json(&room.p2)],
                }));
                room.spectators.push(tx);
            }
            None => send(&tx, json!({
                "type": "error",
                "message": "This match hasn't started yet — try again in a moment.",
            })),
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
                    let _ = room.p2.tx.send(payload.clone());
                    broadcast_to_spectators(room, &payload);
                }

                let state_payload = json!({
                    "type": "state_update",
                    "players": [player_json(&room.p1), player_json(&room.p2)],
                }).to_string();
                let _ = room.p1.tx.send(state_payload.clone());
                let _ = room.p2.tx.send(state_payload.clone());
                broadcast_to_spectators(room, &state_payload);
            }

            if let Some(info) = ended {
                self.end_room(&room_id, info);
            }
        }
    }

    // ── Disconnect ────────────────────────────────────────────────────────────

    /// An accidental drop — mobile network loss, tab killed, backgrounding.
    /// Unlike the old behaviour (tear the room down unsettled forever,
    /// recoverable only via `POST /admin/duels/{id}/void`), this now PAUSES
    /// the room and gives the dropped wallet `RECONNECT_GRACE` to come back
    /// into the exact same match. Only if they never do does it settle — as
    /// a forfeit-loss, via `on_grace_expired` — so a flaky connection isn't
    /// punished the same as a deliberate quit, but a genuine walkaway still
    /// resolves the stake instead of stranding it.
    fn on_leave(&mut self, wallet: &str, self_tx: &UnboundedSender<ServerMsg>) {
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
        let Some(room) = self.rooms.get_mut(&room_id) else { return };

        // A repeat Leave for a wallet already marked disconnected (e.g. the
        // socket fires both a stream-end and a close event) — the grace
        // timer is already running, don't restart its clock.
        if room.disconnected.contains_key(wallet) {
            return;
        }

        let since = Instant::now();
        room.disconnected.insert(wallet.to_string(), since);
        room.active = false; // freezes the tick — see ArenaRoom::disconnected's doc

        let other_tx = if room.p1.wallet == wallet { room.p2.tx.clone() } else { room.p1.tx.clone() };
        tracing::info!(
            "arena: {} disconnected from room {} — pausing up to {}s for reconnect",
            wallet, room_id, RECONNECT_GRACE.as_secs(),
        );
        send(&other_tx, json!({ "type": "opponent_disconnected", "grace_seconds": RECONNECT_GRACE.as_secs() }));

        let stx = self_tx.clone();
        let rid = room_id.clone();
        let w = wallet.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(RECONNECT_GRACE).await;
            let _ = stx.send(ServerMsg::GraceExpired { room_id: rid, wallet: w, since });
        });
    }

    /// The grace timer from `on_leave` firing. Only acts if the room is
    /// STILL waiting on this exact disconnect — `since` has to match what's
    /// currently recorded, which it won't if the wallet already reconnected
    /// (cleared in `reconnect`) or the room ended some other way in between
    /// (removed entirely). Both make this a safe no-op rather than a race.
    fn on_grace_expired(&mut self, room_id: &str, wallet: &str, since: Instant) {
        let still_disconnected = self.rooms.get(room_id)
            .is_some_and(|r| r.disconnected.get(wallet) == Some(&since));
        if !still_disconnected {
            return;
        }
        tracing::info!("arena: {} never reconnected within the grace window on room {}", wallet, room_id);
        self.settle_forfeit(wallet, "disconnect_timeout");
    }

    /// A deliberate Exit — always settles immediately, forfeit-win for
    /// whoever stayed. No grace period: a player pressing Exit has no
    /// ambiguity the way an accidental drop does.
    fn on_forfeit(&mut self, wallet: &str) {
        self.settle_forfeit(wallet, "forfeit");
    }

    fn settle_forfeit(&mut self, wallet: &str, reason: &'static str) {
        let room_id = match self.player_rooms.get(wallet) {
            Some(id) => id.clone(),
            None => return,
        };
        let (duel_id, p1_wallet, p2_wallet) = match self.rooms.get(&room_id) {
            Some(r) => (r.duel_id, r.p1.wallet.clone(), r.p2.wallet.clone()),
            None => return,
        };
        let winner_wallet = if p1_wallet == wallet { p2_wallet.clone() } else { p1_wallet.clone() };
        tracing::info!("arena: {} settled as {} in room {} — {} wins", wallet, reason, room_id, winner_wallet);
        self.end_room(&room_id, MatchEndInfo {
            duel_id, p1_wallet, p2_wallet,
            winner_wallet: Some(winner_wallet),
            reason,
        });
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
        // Spectators aren't a participant, so no personal win/loss framing —
        // just who actually won.
        broadcast_to_spectators(&room, &json!({
            "type": "spectate_match_end",
            "winner_wallet": info.winner_wallet,
            "reason": info.reason,
        }).to_string());

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

    // `winner_wallet` column is nullable — a draw (rare: an exact-HP timeout
    // tie) records as one honestly, rather than being skipped. `counts_result`
    // must mirror `award_player`'s `!is_draw` above (same-fight numbers, see
    // `persist_battle`'s own doc on why these two can never be allowed to drift).
    if let (Some(a1), Some(a2)) = (&award1, &award2) {
        let battle_id = Uuid::new_v4();
        battles::persist_battle(
            &app_state, battle_id, &info.p1_wallet, &info.p2_wallet, info.winner_wallet.as_deref(),
            a1.xp_earned, a2.xp_earned, false, json!([]), true, "pvp", !is_draw,
        ).await;
    }

    // Track + display only for now — no effect on matchmaking or stakes.
    let p1_outcome = if is_draw { None } else { Some(p1_won) };
    update_face_off_ratings(&app_state.db, &info.p1_wallet, &info.p2_wallet, p1_outcome).await;
}

const ELO_K: f64 = 32.0;
const ELO_DEFAULT: i32 = 1200;

async fn get_face_off_rating(db: &PgPool, wallet: &str) -> i32 {
    sqlx::query_scalar::<_, i32>("SELECT rating FROM face_off_ratings WHERE wallet_address = $1")
        .bind(wallet)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .unwrap_or(ELO_DEFAULT)
}

/// Standard Elo: `expected_a` is A's win probability given the rating gap,
/// and the rating moves toward the ACTUAL result by `K * (actual - expected)`.
/// A draw (`score_a = 0.5`) still shifts ratings toward each other when
/// they're unequal — that's correct Elo behaviour, not a bug: the lower-rated
/// side "outperformed expectation" by merely drawing a stronger opponent.
fn elo_delta(rating_a: i32, rating_b: i32, score_a: f64) -> i32 {
    let expected_a = 1.0 / (1.0 + 10f64.powf((rating_b - rating_a) as f64 / 400.0));
    (ELO_K * (score_a - expected_a)).round() as i32
}

/// `p1_won`: `Some(true)` = p1 won, `Some(false)` = p2 won, `None` = draw.
async fn update_face_off_ratings(db: &PgPool, p1: &str, p2: &str, p1_won: Option<bool>) {
    let r1 = get_face_off_rating(db, p1).await;
    let r2 = get_face_off_rating(db, p2).await;
    let score1 = match p1_won { Some(true) => 1.0, Some(false) => 0.0, None => 0.5 };
    let new1 = r1 + elo_delta(r1, r2, score1);
    let new2 = r2 + elo_delta(r2, r1, 1.0 - score1);

    for (wallet, rating) in [(p1, new1), (p2, new2)] {
        let _ = sqlx::query(
            "INSERT INTO face_off_ratings (wallet_address, rating, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (wallet_address) DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()",
        )
        .bind(wallet)
        .bind(rating)
        .execute(db)
        .await;
    }
}

fn player_json(p: &PlayerState) -> serde_json::Value {
    json!({
        "wallet": p.wallet, "x": p.x, "z": p.z, "yaw": p.yaw, "pitch": p.pitch,
        "hp": p.hp, "ammo": p.ammo, "reloading": p.reloading,
        "crouching": p.last_input.crouching, "ads": p.last_input.ads,
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
    // velocity, no accel curve" feel ValorScene.tsx uses client-side, now
    // integrated against the room's real walls/cover (collide-and-slide, see
    // `resolve_move`) instead of trusting an open box.
    let raw_len = (input.move_x * input.move_x + input.move_y * input.move_y).sqrt();
    let (mx, my) = if raw_len > 1.0 { (input.move_x / raw_len, input.move_y / raw_len) } else { (input.move_x, input.move_y) };
    let (sy, cy) = p.yaw.sin_cos();
    let dir_x = sy * my + cy * mx;
    let dir_z = cy * my + (-sy) * mx;
    let target_x = p.x + dir_x * WALK_SPEED * dt;
    let target_z = p.z + dir_z * WALK_SPEED * dt;
    let (resolved_x, resolved_z) = resolve_move(p.x, p.z, target_x, target_z, PLAYER_RADIUS);
    p.x = resolved_x.clamp(-ARENA_HALF_X, ARENA_HALF_X);
    p.z = resolved_z.clamp(-ARENA_HALF_Z, ARENA_HALF_Z);

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

/// Does a circle of radius `r` centred at `(cx, cz)` overlap `o` in the XZ
/// plane? (2D only — obstacle height doesn't matter for ground movement.)
fn circle_hits_obstacle(cx: f32, cz: f32, r: f32, o: &Obstacle) -> bool {
    (cx - o.x).abs() < o.hx + r && (cz - o.z).abs() < o.hz + r
}

fn blocked(x: f32, z: f32, r: f32) -> bool {
    obstacles().any(|o| circle_hits_obstacle(x, z, r, o))
}

/// Collide-and-slide from `(px, pz)` toward `(tx, tz)`: take the full move if
/// clear, otherwise try each axis alone (so sliding along a wall you're
/// walking into still works), otherwise stay put. A discrete overlap test
/// rather than a continuous sweep — same simplification `slideMove` in
/// `FpsSim.ts` makes conceptually, and safe here because one tick's move
/// (WALK_SPEED * dt ≈ 0.17m) is small next to every wall's 0.6m thickness, so
/// there's no tunneling risk to sweep against.
fn resolve_move(px: f32, pz: f32, tx: f32, tz: f32, r: f32) -> (f32, f32) {
    if !blocked(tx, tz, r) {
        return (tx, tz);
    }
    if !blocked(tx, pz, r) {
        return (tx, pz);
    }
    if !blocked(px, tz, r) {
        return (px, tz);
    }
    (px, pz)
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

/// Spread narrows multiplicatively under ADS and/or crouch — same shape as
/// `FpsSim.ts`'s `spreadFor` (`ADS_SPREAD_MULT`/`CROUCH_SPREAD_MULT` above).
fn effective_spread_half_angle(crouching: bool, ads: bool) -> f32 {
    let mut s = SPREAD_HALF_ANGLE;
    if ads { s *= ADS_SPREAD_MULT; }
    if crouching { s *= CROUCH_SPREAD_MULT; }
    s
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

    let spread = effective_spread_half_angle(shooter.last_input.crouching, shooter.last_input.ads);
    let jitter_yaw = (rng.next_f32() - 0.5) * 2.0 * spread;
    let jitter_pitch = (rng.next_f32() - 0.5) * 2.0 * spread;
    let shooter_eye = if shooter.last_input.crouching { EYE_HEIGHT_CROUCH } else { EYE_HEIGHT };
    let origin = (shooter.x, shooter_eye, shooter.z);
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
/// model (head/torso/legs/2×arms) for this first pass — OR `None` if a wall
/// or cover box sits closer along the ray than either hitbox, in which case
/// the shot is obstructed and never reaches the target at all.
fn resolve_shot(origin: (f32, f32, f32), dir: (f32, f32, f32), target: &PlayerState) -> Option<HitPart> {
    let target_crouched = target.last_input.crouching;
    let target_eye = if target_crouched { EYE_HEIGHT_CROUCH } else { EYE_HEIGHT };
    let body_max_y = if target_crouched { BODY_MAX_Y_CROUCH } else { BODY_MAX_Y };

    let head_t = ray_sphere(origin, dir, (target.x, target_eye, target.z), HEAD_RADIUS);
    let body_min = (target.x - BODY_HALF_X, BODY_MIN_Y, target.z - BODY_HALF_Z);
    let body_max = (target.x + BODY_HALF_X, body_max_y, target.z + BODY_HALF_Z);
    let body_t = ray_aabb(origin, dir, body_min, body_max);

    let hit = match (head_t, body_t) {
        (Some(ht), Some(bt)) => Some((if ht <= bt { HitPart::Head } else { HitPart::Body }, ht.min(bt))),
        (Some(ht), None) => Some((HitPart::Head, ht)),
        (None, Some(bt)) => Some((HitPart::Body, bt)),
        (None, None) => None,
    };
    let (part, hit_t) = hit?;

    // Obstructed if any wall/cover box's own ray intersection is nearer than
    // the hitbox that would otherwise be hit — a wall in front of the target
    // beats the target every time.
    let block_t = obstacles()
        .filter_map(|o| ray_aabb(origin, dir, o.min(), o.max()))
        .fold(f32::INFINITY, f32::min);
    if block_t < hit_t {
        return None;
    }
    Some(part)
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

fn broadcast_to_spectators(room: &ArenaRoom, payload: &str) {
    for tx in &room.spectators {
        let _ = tx.send(payload.to_string());
    }
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

        // Request a full 180-degree flip in one input sample — p1 spawns
        // facing yaw=0.0 (see `create_room`), so the flip target is PI.
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
    async fn crouched_shot_through_chest_high_cover_is_blocked_but_standing_clears_it() {
        // Cover box 1 (ROOM_COVER[0]) sits at x=-6, z=0, spanning z=[-0.8,0.8],
        // height 1.15 — chest-high: a standing shot (eye 1.6) flies over it,
        // a crouched one (eye 1.02, inside the box's 0..1.15 span) doesn't.
        // Both fighters stand at x=-6 (well inside the box's x-span) on
        // opposite sides of it, aimed straight at each other (yaw=0 = +Z).
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;
        {
            let room = server.rooms.get_mut(&duel_id.to_string()).unwrap();
            room.p1.x = -6.0; room.p1.z = -3.0;
            room.p2.x = -6.0; room.p2.z = 3.0;
        }

        // Standing: let aim settle, then fire — should land (nothing at
        // standing eye height 1.6 obstructs it).
        server.on_input("0xAAA", InputSample { yaw: 0.0, pitch: 0.0, ..Default::default() });
        for _ in 0..5 { server.on_tick(); let _ = next_json(&mut rx1).await; let _ = next_json(&mut rx2).await; }
        server.on_input("0xAAA", InputSample { firing: true, yaw: 0.0, pitch: 0.0, ..Default::default() });
        let mut standing_hit = false;
        for _ in 0..5 {
            server.on_tick();
            let msg = next_json(&mut rx1).await;
            let _ = next_json(&mut rx2).await;
            if msg["type"] == "hit_confirm" { standing_hit = true; break; }
        }
        assert!(standing_hit, "a standing shot over chest-high cover should land");

        // Reset and try again, both crouched — should now be blocked.
        let mut server = new_server();
        let (mut rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;
        {
            let room = server.rooms.get_mut(&duel_id.to_string()).unwrap();
            room.p1.x = -6.0; room.p1.z = -3.0;
            room.p2.x = -6.0; room.p2.z = 3.0;
        }
        server.on_input("0xAAA", InputSample { yaw: 0.0, pitch: 0.0, crouching: true, ..Default::default() });
        server.on_input("0xBBB", InputSample { crouching: true, ..Default::default() });
        for _ in 0..5 { server.on_tick(); let _ = next_json(&mut rx1).await; let _ = next_json(&mut rx2).await; }
        server.on_input("0xAAA", InputSample { firing: true, yaw: 0.0, pitch: 0.0, crouching: true, ..Default::default() });
        let mut crouched_hit = false;
        for _ in 0..8 {
            server.on_tick();
            let msg = next_json(&mut rx1).await;
            let _ = next_json(&mut rx2).await;
            if msg["type"] == "hit_confirm" { crouched_hit = true; break; }
        }
        assert!(!crouched_hit, "a crouched shot through chest-high cover should be blocked");
    }

    #[tokio::test]
    async fn walking_straight_into_the_far_wall_stops_before_crossing_it() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, _rx2) = paired_and_fighting(&mut server, duel_id).await;

        // Moved to x=5.0 first — a lane clear of every ROOM_COVER box's
        // buffered footprint (box3 at x=3 ends at 4.35+PLAYER_RADIUS, box4 at
        // x=6.8 starts at 5.55-PLAYER_RADIUS) but still well inside the side
        // walls, so this run isolates WALL collision from cover collision
        // (there's a separate test for cover). Facing yaw=PI (forward = -Z)
        // straight down that lane toward the sealed south cap at z=-8.8
        // (inner face -8.5) — enough ticks to cross the whole ~15.8m room if
        // nothing stopped it. yaw is held at PI explicitly on every input —
        // it defaults to 0.0 otherwise, which would steer the aim (and so the
        // camera-relative movement direction) away from spawn-facing within
        // a few ticks at MAX_YAW_RATE, sending the player the wrong way.
        {
            let room = server.rooms.get_mut(&duel_id.to_string()).unwrap();
            room.p1.x = 5.0; room.p1.z = 7.3;
        }
        server.on_input("0xAAA", InputSample { move_y: 1.0, yaw: PI, ..Default::default() });
        for _ in 0..200 {
            server.on_tick();
            let _ = next_json(&mut rx1).await;
        }
        let z_after = server.rooms.get(&duel_id.to_string()).unwrap().p1.z;
        assert!(
            z_after > -8.5,
            "collision with the sealed south wall must stop the player before its inner face, got z={}",
            z_after,
        );
        assert!(z_after < 0.0, "should have travelled well into the room before being stopped");
    }

    #[test]
    fn crouching_and_ads_each_narrow_spread_and_stack_together() {
        let hip_standing = effective_spread_half_angle(false, false);
        let hip_crouched = effective_spread_half_angle(true, false);
        let ads_standing = effective_spread_half_angle(false, true);
        let ads_crouched = effective_spread_half_angle(true, true);

        assert!(hip_crouched < hip_standing, "crouching should tighten spread");
        assert!(ads_standing < hip_standing, "ADS should tighten spread");
        assert!(ads_crouched < ads_standing, "crouching while ADS should tighten it further");
        assert!(ads_crouched < hip_crouched, "ADS while crouching should tighten it further");
    }

    #[tokio::test]
    async fn leaving_mid_fight_pauses_the_room_instead_of_tearing_it_down() {
        // The actual fix for the 2026-08-23 stuck-duel incident: an
        // accidental drop no longer ends the match unsettled forever — it
        // pauses (room stays alive, ticking stops) and gives the dropped
        // wallet a grace window to reconnect. See the reconnect tests below
        // for what happens on either side of that window.
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let (_rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_leave("0xAAA", &self_tx);
        let msg = next_json(&mut rx2).await;
        assert_eq!(msg["type"], "opponent_disconnected");
        assert!(msg["grace_seconds"].as_u64().unwrap() > 0);

        let room = server.rooms.get(&duel_id.to_string()).expect("room must survive a plain disconnect");
        assert!(!room.active, "ticking must freeze while a wallet is disconnected");
        assert!(room.disconnected.contains_key("0xAAA"));
        assert!(server.player_rooms.contains_key("0xAAA"), "the seat must stay reserved for a reconnect");
    }

    #[tokio::test]
    async fn reconnecting_within_the_grace_window_resumes_the_match() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let (_rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_leave("0xAAA", &self_tx);
        let _ = next_json(&mut rx2).await; // opponent_disconnected, asserted above

        let (rejoin, mut rx3) = entry(duel_id, "0xAAA");
        server.on_join(rejoin, &self_tx);

        let reconnected_msg = next_json(&mut rx3).await;
        assert_eq!(reconnected_msg["type"], "reconnected");
        assert_eq!(reconnected_msg["resumed"], true);
        assert_eq!(reconnected_msg["players"].as_array().unwrap().len(), 2);

        let opp_msg = next_json(&mut rx2).await;
        assert_eq!(opp_msg["type"], "opponent_reconnected");

        let room = server.rooms.get(&duel_id.to_string()).expect("room must still exist");
        assert!(room.active, "ticking must resume once both sides are back");
        assert!(room.disconnected.is_empty());
    }

    #[tokio::test]
    async fn failing_to_reconnect_within_the_grace_window_settles_as_a_forfeit_loss() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let (mut rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_leave("0xAAA", &self_tx);
        let _ = next_json(&mut rx2).await; // opponent_disconnected
        let since = *server.rooms.get(&duel_id.to_string()).unwrap().disconnected.get("0xAAA").unwrap();

        server.on_grace_expired(&duel_id.to_string(), "0xAAA", since);

        let msg1 = next_json(&mut rx1).await;
        let msg2 = next_json(&mut rx2).await;
        assert_eq!(msg1["type"], "match_end");
        assert_eq!(msg1["result"], "loss");
        assert_eq!(msg1["reason"], "disconnect_timeout");
        assert_eq!(msg2["type"], "match_end");
        assert_eq!(msg2["result"], "win");
        assert!(server.rooms.is_empty(), "a settled match's room must be torn down");
    }

    #[tokio::test]
    async fn a_stale_grace_timer_is_a_no_op_once_the_wallet_has_reconnected() {
        // Simulates the actual race the `since` check exists for: the grace
        // timer that was scheduled at disconnect time still fires (it's a
        // plain tokio::time::sleep, nothing cancels it), but by then the
        // wallet is already back — this must NOT forfeit them anyway.
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let (mut rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_leave("0xAAA", &self_tx);
        let _ = next_json(&mut rx2).await; // opponent_disconnected
        let stale_since = *server.rooms.get(&duel_id.to_string()).unwrap().disconnected.get("0xAAA").unwrap();

        let (rejoin, mut rx3) = entry(duel_id, "0xAAA");
        server.on_join(rejoin, &self_tx);
        let _ = next_json(&mut rx3).await; // reconnected
        let _ = next_json(&mut rx2).await; // opponent_reconnected

        server.on_grace_expired(&duel_id.to_string(), "0xAAA", stale_since);

        assert!(server.rooms.contains_key(&duel_id.to_string()), "the stale timer must not tear down a resumed match");
        assert!(rx1.try_recv().is_err(), "no match_end should fire from a stale timer");
        assert!(rx2.try_recv().is_err());
    }

    #[tokio::test]
    async fn both_sides_dropping_only_resumes_once_both_have_reconnected() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let (_rx1, _rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_leave("0xAAA", &self_tx);
        server.on_leave("0xBBB", &self_tx);
        assert_eq!(server.rooms.get(&duel_id.to_string()).unwrap().disconnected.len(), 2);

        let (rejoin_a, mut rx_a) = entry(duel_id, "0xAAA");
        server.on_join(rejoin_a, &self_tx);
        let msg_a = next_json(&mut rx_a).await;
        assert_eq!(msg_a["resumed"], false, "the other side is still gone, so this reconnect alone shouldn't resume ticking");
        assert!(!server.rooms.get(&duel_id.to_string()).unwrap().active);

        let (rejoin_b, mut rx_b) = entry(duel_id, "0xBBB");
        server.on_join(rejoin_b, &self_tx);
        let msg_b = next_json(&mut rx_b).await;
        assert_eq!(msg_b["resumed"], true);
        let opp_msg = next_json(&mut rx_a).await;
        assert_eq!(opp_msg["type"], "opponent_reconnected", "the first reconnector should be told once the second one is back too");
        assert!(server.rooms.get(&duel_id.to_string()).unwrap().active);
    }

    #[tokio::test]
    async fn forfeiting_ends_the_match_as_a_real_win_for_the_opponent() {
        // Unlike on_leave (an ambiguous drop — could be a flaky connection),
        // on_forfeit (the Exit button) is a deliberate action and always
        // settles: the remaining player gets a proper match_end, not the
        // vaguer opponent_disconnected.
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        server.on_forfeit("0xAAA");
        let msg1 = next_json(&mut rx1).await;
        let msg2 = next_json(&mut rx2).await;
        assert_eq!(msg1["type"], "match_end");
        assert_eq!(msg1["result"], "loss");
        assert_eq!(msg1["reason"], "forfeit");
        assert_eq!(msg2["type"], "match_end");
        assert_eq!(msg2["result"], "win");
        assert_eq!(msg2["reason"], "forfeit");
        assert!(server.rooms.is_empty(), "the room must be torn down like any other finished match");
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

    #[tokio::test]
    async fn spectating_a_live_match_gets_a_snapshot_then_live_ticks() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        server.on_spectate(duel_id, spec_tx);
        let joined = next_json(&mut spec_rx).await;
        assert_eq!(joined["type"], "spectate_joined");
        assert_eq!(joined["players"].as_array().unwrap().len(), 2);

        server.on_tick();
        let _ = next_json(&mut rx1).await;
        let _ = next_json(&mut rx2).await;
        let spec_update = next_json(&mut spec_rx).await;
        assert_eq!(spec_update["type"], "state_update", "a spectator must see the same live ticks the players do");
    }

    #[tokio::test]
    async fn spectating_a_duel_with_no_live_room_gets_a_clear_error_not_silence() {
        let mut server = new_server();
        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        server.on_spectate(Uuid::new_v4(), spec_tx);
        let msg = next_json(&mut spec_rx).await;
        assert_eq!(msg["type"], "error");
    }

    #[tokio::test]
    async fn a_spectator_sees_the_match_end_but_never_receives_input_capability() {
        let mut server = new_server();
        let duel_id = Uuid::new_v4();
        let (mut rx1, mut rx2) = paired_and_fighting(&mut server, duel_id).await;

        let (spec_tx, mut spec_rx) = mpsc::unbounded_channel();
        server.on_spectate(duel_id, spec_tx);
        let _ = next_json(&mut spec_rx).await; // spectate_joined

        server.on_forfeit("0xAAA");
        let _ = next_json(&mut rx1).await;
        let _ = next_json(&mut rx2).await;
        let spec_end = next_json(&mut spec_rx).await;
        assert_eq!(spec_end["type"], "spectate_match_end");
        assert_eq!(spec_end["winner_wallet"], "0xBBB");

        // Nothing in ServerMsg lets a spectator's tx double as a wallet's
        // input channel — there is no wallet to route Input through, since
        // on_spectate never touches player_rooms. This is a structural
        // guarantee, not a runtime check, so there is nothing further to
        // assert here beyond the room having accepted no such capability.
        assert!(server.player_rooms.is_empty());
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
    fn equal_ratings_split_the_full_k_factor_on_a_decisive_result() {
        // Two equally-rated players: expected win probability is exactly 50%
        // either way, so the winner gains and the loser loses the same
        // K*(1-0.5) = 16 points (K=32).
        assert_eq!(elo_delta(1200, 1200, 1.0), 16);
        assert_eq!(elo_delta(1200, 1200, 0.0), -16);
    }

    #[test]
    fn an_upset_win_gains_more_than_a_win_over_a_weaker_opponent() {
        let upset = elo_delta(1200, 1400, 1.0); // beating a HIGHER-rated opponent
        let expected_win = elo_delta(1400, 1200, 1.0); // beating a LOWER-rated opponent
        assert!(upset > expected_win, "an upset should gain more than a expected win, got {} vs {}", upset, expected_win);
    }

    #[test]
    fn a_draw_between_unequal_ratings_still_shifts_toward_each_other() {
        // The lower-rated side drawing a stronger opponent outperformed
        // expectation — their rating should still rise, and the stronger
        // side's should still fall, even though nobody "won".
        let lower_delta = elo_delta(1200, 1400, 0.5);
        let higher_delta = elo_delta(1400, 1200, 0.5);
        assert!(lower_delta > 0, "the underdog drawing a stronger player should gain rating");
        assert!(higher_delta < 0, "the favourite only drawing a weaker player should lose rating");
    }

    #[test]
    fn equal_ratings_drawing_is_a_perfect_wash() {
        assert_eq!(elo_delta(1200, 1200, 0.5), 0);
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
