//! Connection registry for friend chat — "which sockets does this wallet have
//! open right now", so `handlers/chat.rs` can push a new message the instant
//! it's written, without the recipient having to poll.
//!
//! Deliberately NOT built on `game_server`'s actor/channel model — that models
//! matchmaking and battle rooms (stateful, one room per pair). Chat just needs
//! presence pub-sub, so a plain `Arc<DashMap<..>>` (the same shape already used
//! for `bot_fight_sessions`/`live_fight_sessions` in AppState) is the simpler fit.
//! A wallet can have more than one live connection (multiple tabs/devices), so
//! each entry is a list; the Uuid lets a specific connection remove only its own
//! entry on disconnect rather than clobbering a sibling tab's.

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

pub type ChatHub = Arc<DashMap<String, Vec<(Uuid, UnboundedSender<String>)>>>;

pub fn new_hub() -> ChatHub {
    Arc::new(DashMap::new())
}

pub fn register(hub: &ChatHub, wallet: &str, tx: UnboundedSender<String>) -> Uuid {
    let conn_id = Uuid::new_v4();
    hub.entry(wallet.to_string()).or_default().push((conn_id, tx));
    conn_id
}

pub fn unregister(hub: &ChatHub, wallet: &str, conn_id: Uuid) {
    if let Some(mut conns) = hub.get_mut(wallet) {
        conns.retain(|(id, _)| *id != conn_id);
        if conns.is_empty() {
            drop(conns);
            hub.remove(wallet);
        }
    }
}

/// Best-effort — a dead channel (tab closed but disconnect hasn't landed yet)
/// is just skipped, same as `notify_wallet`'s send-and-continue in push.rs.
pub fn send_to(hub: &ChatHub, wallet: &str, json_text: String) {
    if let Some(conns) = hub.get(wallet) {
        for (_, tx) in conns.iter() {
            let _ = tx.send(json_text.clone());
        }
    }
}
