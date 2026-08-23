//! Co-op Endless — a free, unstaked party mode where 2+ players fight the
//! same AI wave together. Modeled on `arena_server.rs`'s actor/channel
//! pattern (one long-lived task, one `mpsc` inbox, an in-memory room map),
//! but this file is deliberately NOT a referee the way that one is:
//!
//!   - Nothing here is staked, so there is no cheating peer to protect
//!     against. The host is a trusted friend, not an adversary — this actor
//!     exists purely to RELAY opaque JSON between party members: the host's
//!     `FpsSim` snapshot out to everyone, and each non-host player's input
//!     back to the host. It never parses gameplay semantics (position, HP,
//!     hits) — that discipline is what keeps it a genuine dumb relay instead
//!     of a second `arena_server.rs`. `serde_json::Value` fields are relayed
//!     verbatim, not typed against any FPS-specific shape.
//!
//!   - No DB table, no `PgPool`. A party is exactly as ephemeral as an
//!     `arena_server.rs` room — it exists only while people are actively
//!     playing — but unlike a duel there is no payout to reconcile
//!     afterward (nothing was staked), so nothing here needs to survive a
//!     server restart or be auditable later. Purely in-memory.
//!
//!   - No fixed `Tick` loop. `arena_server.rs` steps a real physics/combat
//!     simulation every 50ms server-side; this file simulates nothing —
//!     the host's own client does that — so it only ever reacts to
//!     messages, same event-driven shape as `game_server.rs`.

use std::collections::HashMap;
use rand::Rng as _;
use tokio::sync::mpsc::{self, UnboundedSender};
use serde_json::{json, Value};

// ── Public handle — cheaply cloneable, passed into AppState ──────────────────

#[derive(Clone)]
pub struct CoopServerHandle {
    pub tx: UnboundedSender<ServerMsg>,
}

impl CoopServerHandle {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let self_tx = tx.clone();
        tokio::spawn(CoopServer::new().run(rx, self_tx));
        Self { tx }
    }
}

// ── Messages flowing into the co-op server task ───────────────────────────────

pub enum ServerMsg {
    CreateParty { wallet: String, name: String, tx: UnboundedSender<String> },
    JoinParty { code: String, wallet: String, name: String, tx: UnboundedSender<String> },
    /// Host-only; the server silently ignores this from anyone else —
    /// defense in depth, the client UI never shows the button to a non-host
    /// in the first place.
    StartRun { wallet: String },
    /// The host's `sim.snapshot()`, relayed verbatim to every non-host
    /// member. Host-only, same "ignored from anyone else" defense as above.
    HostState { wallet: String, snapshot: Value },
    /// A non-host player's position/aim/fire-intent, relayed to the host
    /// only, tagged with whose it is.
    RemoteInput { wallet: String, payload: Value },
    /// The host's own wave-clear detection, fanned out so every party
    /// member's client independently fires its own `/endless/wave` call —
    /// see `apps/api/src/handlers/endless.rs`, already scoped per-session-
    /// per-wallet, so no server-side coordination is needed here beyond
    /// telling everyone the moment happened.
    WaveCleared { wallet: String, wave: u32 },
    Leave { wallet: String },
}

// ── Internal state ────────────────────────────────────────────────────────────

struct Member {
    name: String,
    tx: UnboundedSender<String>,
}

struct CoopParty {
    host_wallet: String,
    /// Includes the host — one lookup for "who's in this party" rather than
    /// keeping the host in a separate field from everyone else.
    members: HashMap<String, Member>,
    /// Rolled once at creation, handed to every joiner. `generateRoom` in
    /// `apps/web/src/engine/fps/endless.ts` is a pure function of (index,
    /// zNear, seed) — this is the ONLY thing about room geometry that ever
    /// needs to cross the wire; two clients given the same seed compute
    /// byte-identical layouts on their own.
    seed: u32,
    started: bool,
}

/// No ambiguous characters (0/O, 1/I/L) — this gets read aloud/typed by
/// players, unlike a duel's UUID which is never manually entered.
const CODE_CHARS: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 5;

fn gen_code() -> String {
    let mut rng = rand::rng();
    (0..CODE_LEN)
        .map(|_| CODE_CHARS[rng.random_range(0..CODE_CHARS.len())] as char)
        .collect()
}

struct CoopServer {
    parties: HashMap<String, CoopParty>,
    /// Which party (by code) a wallet currently sits in — mirrors
    /// `arena_server.rs`'s `player_rooms`, so every non-create/join message
    /// only ever needs to carry a wallet, not a code, to find its party.
    player_party: HashMap<String, String>,
}

impl CoopServer {
    fn new() -> Self {
        Self { parties: HashMap::new(), player_party: HashMap::new() }
    }

    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<ServerMsg>, self_tx: UnboundedSender<ServerMsg>) {
        let _ = &self_tx; // reserved — no self-sent messages yet (no Tick), kept for parity with arena_server.rs's shape
        while let Some(msg) = rx.recv().await {
            self.handle(msg);
        }
    }

    fn handle(&mut self, msg: ServerMsg) {
        match msg {
            ServerMsg::CreateParty { wallet, name, tx } => self.on_create_party(wallet, name, tx),
            ServerMsg::JoinParty { code, wallet, name, tx } => self.on_join_party(code, wallet, name, tx),
            ServerMsg::StartRun { wallet } => self.on_start_run(&wallet),
            ServerMsg::HostState { wallet, snapshot } => self.on_host_state(&wallet, snapshot),
            ServerMsg::RemoteInput { wallet, payload } => self.on_remote_input(&wallet, payload),
            ServerMsg::WaveCleared { wallet, wave } => self.on_wave_cleared(&wallet, wave),
            ServerMsg::Leave { wallet } => self.on_leave(&wallet),
        }
    }

    // ── Party formation ────────────────────────────────────────────────────────

    fn on_create_party(&mut self, wallet: String, name: String, tx: UnboundedSender<String>) {
        // A stray double-create (double-tap, a reconnect racing a fresh
        // create) — drop them from whatever party they were already in
        // first, same "don't double-seat" instinct `arena_server.rs`'s
        // on_join has, just simpler since there's no reconnect-into-the-
        // same-fight case to preserve here.
        if self.player_party.contains_key(&wallet) {
            self.on_leave(&wallet);
        }

        let mut code = gen_code();
        while self.parties.contains_key(&code) {
            code = gen_code();
        }
        let seed: u32 = rand::rng().random();

        let mut members = HashMap::new();
        members.insert(wallet.clone(), Member { name, tx: tx.clone() });
        self.parties.insert(code.clone(), CoopParty {
            host_wallet: wallet.clone(),
            members,
            seed,
            started: false,
        });
        self.player_party.insert(wallet.clone(), code.clone());

        tracing::info!("coop: {} created party {}", wallet, code);
        send(&tx, json!({ "type": "party_created", "code": code, "seed": seed }).to_string());
    }

    fn on_join_party(&mut self, code: String, wallet: String, name: String, tx: UnboundedSender<String>) {
        if self.player_party.contains_key(&wallet) {
            self.on_leave(&wallet);
        }

        let Some(party) = self.parties.get_mut(&code) else {
            send_err(&tx, "Party not found");
            return;
        };
        if party.started {
            send_err(&tx, "This run has already started");
            return;
        }

        party.members.insert(wallet.clone(), Member { name: name.clone(), tx: tx.clone() });
        self.player_party.insert(wallet.clone(), code.clone());

        let roster: Vec<Value> = party.members.iter()
            .map(|(w, m)| json!({ "wallet": w, "name": m.name }))
            .collect();
        tracing::info!("coop: {} joined party {}", wallet, code);
        send(&tx, json!({
            "type": "party_joined", "code": code, "seed": party.seed,
            "host_wallet": party.host_wallet, "members": roster,
        }).to_string());

        let joined_msg = json!({ "type": "member_joined", "wallet": wallet, "name": name }).to_string();
        for (w, m) in party.members.iter() {
            if w != &wallet {
                send(&m.tx, joined_msg.clone());
            }
        }
    }

    // ── In-party messages ─────────────────────────────────────────────────────

    fn on_start_run(&mut self, wallet: &str) {
        let Some(code) = self.player_party.get(wallet) else { return };
        let Some(party) = self.parties.get_mut(code) else { return };
        if party.host_wallet != wallet {
            return; // host-only; silently ignored from anyone else
        }
        party.started = true;
        let msg = json!({ "type": "run_started" }).to_string();
        for m in party.members.values() {
            send(&m.tx, msg.clone());
        }
    }

    fn on_host_state(&mut self, wallet: &str, snapshot: Value) {
        let Some(code) = self.player_party.get(wallet) else { return };
        let Some(party) = self.parties.get(code) else { return };
        if party.host_wallet != wallet {
            return; // only the host's own client may broadcast state
        }
        let msg = json!({ "type": "state_update", "snapshot": snapshot }).to_string();
        for (w, m) in party.members.iter() {
            if w != wallet {
                send(&m.tx, msg.clone());
            }
        }
    }

    fn on_remote_input(&mut self, wallet: &str, payload: Value) {
        let Some(code) = self.player_party.get(wallet) else { return };
        let Some(party) = self.parties.get(code) else { return };
        let Some(host) = party.members.get(&party.host_wallet) else { return };
        send(&host.tx, json!({ "type": "peer_input", "wallet": wallet, "payload": payload }).to_string());
    }

    fn on_wave_cleared(&mut self, wallet: &str, wave: u32) {
        let Some(code) = self.player_party.get(wallet) else { return };
        let Some(party) = self.parties.get(code) else { return };
        if party.host_wallet != wallet {
            return; // only the host's own wave-clear detection is trusted
        }
        let msg = json!({ "type": "wave_cleared", "wave": wave }).to_string();
        for (w, m) in party.members.iter() {
            if w != wallet {
                send(&m.tx, msg.clone());
            }
        }
    }

    // ── Leave ──────────────────────────────────────────────────────────────────

    fn on_leave(&mut self, wallet: &str) {
        let Some(code) = self.player_party.remove(wallet) else { return };
        let Some(party) = self.parties.get_mut(&code) else { return };
        party.members.remove(wallet);

        if party.host_wallet == wallet {
            // No host migration in v1 — the host owns the one authoritative
            // sim, so there's nothing left to tick once they're gone. Soft
            // failure only (nothing was staked), unlike an unresolved
            // Face-Off duel.
            tracing::info!("coop: host {} left party {}, ending it for everyone", wallet, code);
            let msg = json!({ "type": "host_left" }).to_string();
            for m in party.members.values() {
                send(&m.tx, msg.clone());
            }
            self.parties.remove(&code);
        } else {
            tracing::info!("coop: {} left party {}", wallet, code);
            let msg = json!({ "type": "member_left", "wallet": wallet }).to_string();
            for m in party.members.values() {
                send(&m.tx, msg.clone());
            }
            if party.members.is_empty() {
                self.parties.remove(&code);
            }
        }
    }
}

fn send(tx: &UnboundedSender<String>, msg: String) {
    let _ = tx.send(msg);
}

fn send_err(tx: &UnboundedSender<String>, msg: &str) {
    send(tx, json!({ "type": "error", "message": msg }).to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn next_json(rx: &mut mpsc::UnboundedReceiver<String>) -> Value {
        let raw = rx.try_recv().expect("expected a message on this channel");
        serde_json::from_str(&raw).expect("message wasn't valid JSON")
    }

    fn client() -> (UnboundedSender<String>, mpsc::UnboundedReceiver<String>) {
        mpsc::unbounded_channel()
    }

    #[test]
    fn create_party_returns_a_code_and_seed() {
        let mut server = CoopServer::new();
        let (tx, mut rx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), tx);

        let msg = next_json(&mut rx);
        assert_eq!(msg["type"], "party_created");
        assert_eq!(msg["code"].as_str().unwrap().len(), CODE_LEN);
        assert!(msg["seed"].is_number());
        assert_eq!(server.parties.len(), 1);
    }

    #[test]
    fn joining_gets_the_roster_and_notifies_the_host() {
        let mut server = CoopServer::new();
        let (htx, mut hrx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), htx);
        let code = next_json(&mut hrx)["code"].as_str().unwrap().to_string();

        let (jtx, mut jrx) = client();
        server.on_join_party(code.clone(), "0xBBB".into(), "Friend".into(), jtx);

        let joined = next_json(&mut jrx);
        assert_eq!(joined["type"], "party_joined");
        assert_eq!(joined["host_wallet"], "0xAAA");
        assert_eq!(joined["members"].as_array().unwrap().len(), 2);

        let notice = next_json(&mut hrx);
        assert_eq!(notice["type"], "member_joined");
        assert_eq!(notice["wallet"], "0xBBB");
    }

    #[test]
    fn joining_an_unknown_code_errors_without_creating_state() {
        let mut server = CoopServer::new();
        let (tx, mut rx) = client();
        server.on_join_party("ZZZZZ".into(), "0xAAA".into(), "Solo".into(), tx);

        assert_eq!(next_json(&mut rx)["type"], "error");
        assert!(server.player_party.is_empty());
    }

    #[test]
    fn only_the_host_can_start_the_run() {
        let mut server = CoopServer::new();
        let (htx, mut hrx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), htx);
        let code = next_json(&mut hrx)["code"].as_str().unwrap().to_string();
        let (jtx, mut jrx) = client();
        server.on_join_party(code, "0xBBB".into(), "Friend".into(), jtx);
        let _ = next_json(&mut jrx); // party_joined
        let _ = next_json(&mut hrx); // member_joined

        server.on_start_run("0xBBB"); // not the host — ignored
        assert!(hrx.try_recv().is_err());
        assert!(jrx.try_recv().is_err());

        server.on_start_run("0xAAA");
        assert_eq!(next_json(&mut hrx)["type"], "run_started");
        assert_eq!(next_json(&mut jrx)["type"], "run_started");
    }

    #[test]
    fn cannot_join_a_party_that_already_started() {
        let mut server = CoopServer::new();
        let (htx, mut hrx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), htx);
        let code = next_json(&mut hrx)["code"].as_str().unwrap().to_string();
        server.on_start_run("0xAAA");
        let _ = next_json(&mut hrx); // run_started

        let (jtx, mut jrx) = client();
        server.on_join_party(code, "0xBBB".into(), "Late".into(), jtx);
        assert_eq!(next_json(&mut jrx)["type"], "error");
    }

    #[test]
    fn host_state_relays_to_non_host_members_only() {
        let mut server = CoopServer::new();
        let (htx, mut hrx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), htx);
        let code = next_json(&mut hrx)["code"].as_str().unwrap().to_string();
        let (jtx, mut jrx) = client();
        server.on_join_party(code, "0xBBB".into(), "Friend".into(), jtx);
        let _ = next_json(&mut jrx);
        let _ = next_json(&mut hrx);

        server.on_host_state("0xAAA", json!({ "hp": 100 }));
        let update = next_json(&mut jrx);
        assert_eq!(update["type"], "state_update");
        assert_eq!(update["snapshot"]["hp"], 100);
        assert!(hrx.try_recv().is_err(), "the host shouldn't get its own broadcast echoed back");

        // A non-host trying to broadcast state is ignored — only the host's
        // own client is trusted to say what's true.
        server.on_host_state("0xBBB", json!({ "hp": 1 }));
        assert!(jrx.try_recv().is_err());
    }

    #[test]
    fn remote_input_reaches_only_the_host_tagged_with_the_sender() {
        let mut server = CoopServer::new();
        let (htx, mut hrx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), htx);
        let code = next_json(&mut hrx)["code"].as_str().unwrap().to_string();
        let (jtx, mut jrx) = client();
        server.on_join_party(code, "0xBBB".into(), "Friend".into(), jtx);
        let _ = next_json(&mut jrx);
        let _ = next_json(&mut hrx);

        server.on_remote_input("0xBBB", json!({ "x": 1.0, "firing": true }));
        let input = next_json(&mut hrx);
        assert_eq!(input["type"], "peer_input");
        assert_eq!(input["wallet"], "0xBBB");
        assert_eq!(input["payload"]["firing"], true);
        assert!(jrx.try_recv().is_err(), "input never bounces back to its own sender");
    }

    #[test]
    fn wave_cleared_only_from_host_relays_to_everyone_else() {
        let mut server = CoopServer::new();
        let (htx, mut hrx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), htx);
        let code = next_json(&mut hrx)["code"].as_str().unwrap().to_string();
        let (jtx, mut jrx) = client();
        server.on_join_party(code, "0xBBB".into(), "Friend".into(), jtx);
        let _ = next_json(&mut jrx);
        let _ = next_json(&mut hrx);

        server.on_wave_cleared("0xBBB", 3); // not the host — ignored
        assert!(jrx.try_recv().is_err());

        server.on_wave_cleared("0xAAA", 3);
        let msg = next_json(&mut jrx);
        assert_eq!(msg["type"], "wave_cleared");
        assert_eq!(msg["wave"], 3);
    }

    #[test]
    fn a_member_leaving_notifies_the_rest_without_ending_the_party() {
        let mut server = CoopServer::new();
        let (htx, mut hrx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), htx);
        let code = next_json(&mut hrx)["code"].as_str().unwrap().to_string();
        let (jtx, mut jrx) = client();
        server.on_join_party(code.clone(), "0xBBB".into(), "Friend".into(), jtx);
        let _ = next_json(&mut jrx);
        let _ = next_json(&mut hrx);

        server.on_leave("0xBBB");
        let msg = next_json(&mut hrx);
        assert_eq!(msg["type"], "member_left");
        assert_eq!(msg["wallet"], "0xBBB");
        assert!(server.parties.contains_key(&code), "the party survives a non-host leaving");
        assert!(!server.player_party.contains_key("0xBBB"));
    }

    #[test]
    fn the_host_leaving_ends_the_party_for_everyone() {
        let mut server = CoopServer::new();
        let (htx, mut hrx) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), htx);
        let code = next_json(&mut hrx)["code"].as_str().unwrap().to_string();
        let (jtx, mut jrx) = client();
        server.on_join_party(code.clone(), "0xBBB".into(), "Friend".into(), jtx);
        let _ = next_json(&mut jrx);
        let _ = next_json(&mut hrx);

        server.on_leave("0xAAA");
        let msg = next_json(&mut jrx);
        assert_eq!(msg["type"], "host_left");
        assert!(!server.parties.contains_key(&code), "no host migration in v1 — the party is gone");
    }

    #[test]
    fn creating_a_second_party_drops_you_from_the_first() {
        let mut server = CoopServer::new();
        let (tx1, mut rx1) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), tx1);
        let code1 = next_json(&mut rx1)["code"].as_str().unwrap().to_string();

        let (tx2, mut rx2) = client();
        server.on_create_party("0xAAA".into(), "Host".into(), tx2);
        let _ = next_json(&mut rx2); // party_created for the new one

        assert!(!server.parties.contains_key(&code1), "the abandoned party is cleaned up");
        assert_eq!(server.parties.len(), 1);
    }
}
