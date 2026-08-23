//! Face-Off — real-time head-to-head PvP arena, server skeleton.
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
//!   - It runs a fixed-interval `Tick`, not purely event-driven like the
//!     turn-based server. `game_server.rs` only ever reacts to a client action
//!     or a timer; this one also needs to advance and broadcast continuous
//!     state (position/aim) every tick once real movement lands. `Tick` is
//!     just another message sent into the same channel by a periodic spawned
//!     task — the same "timer spawns a message into its own channel" idiom
//!     `game_server.rs` already uses for its countdown/timeout, just repeating.
//!
//! THIS PHASE IS TRANSPORT-ONLY. There is no movement, aiming, or hit
//! detection yet — `PlayerState` holds placeholder spatial fields and `Tick`
//! just re-broadcasts them unchanged, so the join → pair → countdown →
//! fight_start → state_update pipe can be verified end-to-end before any
//! combat logic exists. Real simulation, win conditions, and the call into
//! `duels::resolve_live_duel` land in a later pass.

use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{self, UnboundedSender};
use uuid::Uuid;
use serde_json::json;
use sqlx::PgPool;

// ── Public handle — cheaply cloneable, passed into AppState ──────────────────

#[derive(Clone)]
pub struct ArenaServerHandle {
    pub tx: UnboundedSender<ServerMsg>,
}

impl ArenaServerHandle {
    pub fn spawn(db: PgPool) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let self_tx = tx.clone();
        tokio::spawn(ArenaServer::new(db).run(rx, self_tx.clone()));

        // Drives the fixed tick independently of client traffic — a room with
        // both players silently AFK still needs to keep ticking so a future
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

/// 10Hz for the transport-only skeleton — plenty to prove the pipe works
/// without spamming logs/sockets. Phase 3 raises this once ticks actually
/// carry simulated movement.
const TICK_INTERVAL: Duration = Duration::from_millis(100);

// ── Messages flowing into the arena server task ───────────────────────────────

pub struct ClientEntry {
    pub duel_id: Uuid,
    pub wallet: String,
    pub name: String,
    pub stake_g: i64,
    pub tx: UnboundedSender<String>,
}

/// Raw per-frame input a client sends. Recorded on `PlayerState` but not yet
/// applied to any simulation — Phase 3 turns this into real, server-clamped
/// movement/aim instead of an inert struct.
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
    name: String,
    stake_g: i64,
    tx: UnboundedSender<String>,
    // Placeholder spatial state. Phase 3 replaces "unused" with real
    // server-integrated position/aim; the shape stays the same so the wire
    // protocol (state_update) doesn't need to change again.
    x: f32,
    z: f32,
    yaw: f32,
    hp: i32,
    last_input: InputSample,
}

struct ArenaRoom {
    duel_id: Uuid,
    p1: PlayerState,
    p2: PlayerState,
    #[allow(dead_code)] // read once round timing/timeout logic lands
    started: Instant,
    active: bool,
}

struct ArenaServer {
    // One waiting slot per duel_id — the first player to join sits here until
    // the second arrives (or leaves before they do).
    waiting: HashMap<Uuid, ClientEntry>,
    rooms: HashMap<String, ArenaRoom>,
    player_rooms: HashMap<String, String>,
    #[allow(dead_code)] // read once match-end persists a battles row, like game_server.rs
    db: PgPool,
}

impl ArenaServer {
    fn new(db: PgPool) -> Self {
        Self {
            waiting: HashMap::new(),
            rooms: HashMap::new(),
            player_rooms: HashMap::new(),
            db,
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
                send(&entry.tx, json!({ "type": "waiting_for_opponent" }));
                self.waiting.insert(entry.duel_id, entry);
            }
        }
    }

    fn create_room(&mut self, e1: ClientEntry, e2: ClientEntry, self_tx: &UnboundedSender<ServerMsg>) {
        let room_id = e1.duel_id.to_string();

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
        self.rooms.insert(room_id.clone(), ArenaRoom {
            duel_id: e1.duel_id,
            p1: PlayerState {
                wallet: e1.wallet, name: e1.name, stake_g: e1.stake_g, tx: e1.tx,
                x: -3.0, z: 0.0, yaw: 0.0, hp: 100, last_input: InputSample::default(),
            },
            p2: PlayerState {
                wallet: e2.wallet, name: e2.name, stake_g: e2.stake_g, tx: e2.tx,
                x: 3.0, z: 0.0, yaw: std::f32::consts::PI, hp: 100, last_input: InputSample::default(),
            },
            started: Instant::now(),
            active: false,
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
        // No integration yet — Phase 3 turns this into clamped movement/aim.
    }

    // ── Tick ──────────────────────────────────────────────────────────────────

    fn on_tick(&mut self) {
        for room in self.rooms.values().filter(|r| r.active) {
            let payload = json!({
                "type": "state_update",
                "players": [
                    { "wallet": room.p1.wallet, "x": room.p1.x, "z": room.p1.z, "yaw": room.p1.yaw, "hp": room.p1.hp },
                    { "wallet": room.p2.wallet, "x": room.p2.x, "z": room.p2.z, "yaw": room.p2.yaw, "hp": room.p2.hp },
                ],
            }).to_string();
            let _ = room.p1.tx.send(payload.clone());
            let _ = room.p2.tx.send(payload);
        }
    }

    // ── Disconnect ────────────────────────────────────────────────────────────

    fn on_leave(&mut self, wallet: &str) {
        // Not yet paired — just drop the waiting slot if it's theirs.
        self.waiting.retain(|_, e| e.wallet != wallet);

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

        send(&other_tx, json!({ "type": "opponent_disconnected" }));
        if let Some(room) = self.rooms.remove(&room_id) {
            self.player_rooms.remove(&room.p1.wallet);
            self.player_rooms.remove(&room.p2.wallet);
            // TODO(Phase 3): a disconnect mid-fight should settle the stake
            // (probably a forfeit-win for whoever stayed) via
            // duels::resolve_live_duel, the same way end_room() will on a
            // clean hp_zero/timeout finish. Left as a hard room-teardown with
            // no settlement for now, matching game_server.rs's current
            // behaviour — deliberately not solved in the transport-only pass.
            let _ = room.duel_id;
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn send(tx: &UnboundedSender<String>, val: serde_json::Value) {
    let _ = tx.send(val.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    // `db` is unused by anything these tests exercise (only match-end
    // persistence reads it, and that logic doesn't exist yet) — `connect_lazy`
    // builds a pool without ever dialing out, so these tests don't need a
    // real Postgres instance.
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

    #[tokio::test]
    async fn first_joiner_waits_second_joiner_pairs_into_one_room() {
        let mut server = ArenaServer::new(lazy_pool());
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

    #[tokio::test]
    async fn fight_start_then_tick_broadcasts_state_to_both_players() {
        let mut server = ArenaServer::new(lazy_pool());
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let duel_id = Uuid::new_v4();

        let (e1, mut rx1) = entry(duel_id, "0xAAA");
        let (e2, mut rx2) = entry(duel_id, "0xBBB");
        server.on_join(e1, &self_tx);
        server.on_join(e2, &self_tx);
        let _ = next_json(&mut rx1).await; // waiting_for_opponent
        let _ = next_json(&mut rx1).await; // match_found
        let _ = next_json(&mut rx2).await; // match_found

        let room_id = duel_id.to_string();
        server.fight_start(&room_id);
        assert_eq!(next_json(&mut rx1).await["type"], "fight_start");
        assert_eq!(next_json(&mut rx2).await["type"], "fight_start");

        server.on_tick();
        let state1 = next_json(&mut rx1).await;
        assert_eq!(state1["type"], "state_update");
        let wallets: Vec<String> = state1["players"].as_array().unwrap()
            .iter().map(|p| p["wallet"].as_str().unwrap().to_string()).collect();
        assert_eq!(wallets, vec!["0xAAA", "0xBBB"]);
    }

    #[tokio::test]
    async fn leaving_mid_fight_notifies_the_opponent_and_tears_the_room_down() {
        let mut server = ArenaServer::new(lazy_pool());
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let duel_id = Uuid::new_v4();

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

        server.on_leave("0xAAA");
        assert_eq!(next_json(&mut rx2).await["type"], "opponent_disconnected");
        assert!(server.rooms.is_empty());
        assert!(server.player_rooms.is_empty());
    }

    #[tokio::test]
    async fn a_stray_join_from_an_already_seated_wallet_is_ignored() {
        let mut server = ArenaServer::new(lazy_pool());
        let (self_tx, _self_rx) = mpsc::unbounded_channel();
        let duel_id = Uuid::new_v4();

        let (e1, mut rx1) = entry(duel_id, "0xAAA");
        let (e2, mut rx2) = entry(duel_id, "0xBBB");
        server.on_join(e1, &self_tx);
        server.on_join(e2, &self_tx);
        let _ = next_json(&mut rx1).await; // waiting_for_opponent
        let _ = next_json(&mut rx1).await; // match_found
        let _ = next_json(&mut rx2).await; // match_found

        let (dupe, mut rx3) = entry(duel_id, "0xAAA");
        server.on_join(dupe, &self_tx);
        assert_eq!(server.rooms.len(), 1, "a reseat attempt must not spawn a second room");
        assert!(rx3.try_recv().is_err(), "the stray duplicate connection gets nothing");
    }
}
