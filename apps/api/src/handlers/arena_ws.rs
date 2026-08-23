//! WS transport for Face-Off duels — `GET /ws/arena`.
//!
//! Boilerplate mirrors `ws.rs` almost exactly (session/forwarder plumbing is
//! generic to any actor-backed WS route). The one thing this route adds that
//! `ws.rs` doesn't: before forwarding a `Join` into the arena actor, it checks
//! the claimed wallet is actually one of the two wallets on that `duel_id`'s
//! `duels` row, and that the row is an accepted `face_off` duel. `ws.rs`
//! has no equivalent check (any wallet string is trusted), which is fine for
//! its free-to-play turn-based fighter but not here — a Face-Off match has
//! real G$ already escrowed against two specific wallets.

use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt as _;
use serde::Deserialize;
use uuid::Uuid;
use crate::AppState;
use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::services::arena_server::{ClientEntry, InputSample, ServerMsg};

#[derive(Deserialize)]
struct JoinMsg {
    duel_id: Uuid,
    wallet: String,
}

#[derive(Deserialize)]
struct InputMsg {
    move_x: f32,
    move_y: f32,
    yaw: f32,
    pitch: f32,
    #[serde(default)]
    firing: bool,
    #[serde(default)]
    want_reload: bool,
    #[serde(default)]
    crouching: bool,
    #[serde(default)]
    ads: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Join(JoinMsg),
    Input(InputMsg),
    /// Sent by the client's Exit button, before it closes the socket — see
    /// `ServerMsg::Forfeit`'s doc for why this is a distinct, always-settled
    /// path from an ordinary connection drop.
    Forfeit,
}

/// What `on_join` needs from the `duels` row to admit a wallet into a room —
/// just enough to check identity + stake, nothing score/seed-related since
/// those columns are always NULL for `face_off` rows (see add_duel_modes.sql).
#[derive(sqlx::FromRow)]
struct DuelGate {
    challenger_wallet: String,
    opponent_wallet: Option<String>,
    stake_g: i64,
    status: String,
    mode: String,
}

pub async fn arena_ws(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<AppState>,
) -> Result<HttpResponse, actix_web::Error> {
    // Logged unconditionally, before the upgrade even completes — the 2026-08-23
    // stuck-duel incident had a client that (for a still-undiagnosed reason,
    // likely mobile-Safari-specific) never produced a single /ws/arena log line
    // at all, which made "did the request even arrive" impossible to answer
    // after the fact. This line exists so that question never has to be asked
    // again — the answer is always in the logs now, no correlation required.
    tracing::info!("arena_ws: upgrade request from {:?}", req.peer_addr());
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    let server_tx = state.arena_server.tx.clone();
    let db = state.db.clone();

    let (client_tx, mut client_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let mut fwd_session = session.clone();
    actix_web::rt::spawn(async move {
        while let Some(msg) = client_rx.recv().await {
            if fwd_session.text(msg).await.is_err() {
                break;
            }
        }
    });

    actix_web::rt::spawn(async move {
        let mut wallet: Option<String> = None;

        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Text(text) => {
                    let parsed: ClientMsg = match serde_json::from_str(&text) {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    match parsed {
                        ClientMsg::Join(j) => {
                            if !is_valid_wallet(&j.wallet) {
                                tracing::warn!("arena_ws: join rejected, invalid wallet {:?} for duel {}", j.wallet, j.duel_id);
                                send_err(&client_tx, "Invalid wallet address");
                                continue;
                            }
                            let w = normalize_wallet(&j.wallet);

                            let gate: Option<DuelGate> = sqlx::query_as(
                                "SELECT challenger_wallet, opponent_wallet, stake_g, status, mode
                                 FROM duels WHERE id = $1",
                            )
                            .bind(j.duel_id)
                            .fetch_optional(&db)
                            .await
                            .unwrap_or(None);

                            let gate = match gate {
                                Some(g) => g,
                                None => {
                                    tracing::warn!("arena_ws: join rejected, duel {} not found (wallet {})", j.duel_id, w);
                                    send_err(&client_tx, "Duel not found");
                                    continue;
                                }
                            };
                            if gate.mode != "face_off" {
                                tracing::warn!("arena_ws: join rejected, duel {} is mode={} not face_off (wallet {})", j.duel_id, gate.mode, w);
                                send_err(&client_tx, "Not a face-off duel");
                                continue;
                            }
                            if gate.status != "accepted" {
                                tracing::warn!("arena_ws: join rejected, duel {} status={} not accepted (wallet {})", j.duel_id, gate.status, w);
                                send_err(&client_tx, "Duel isn't ready to fight yet");
                                continue;
                            }
                            let in_duel = gate.challenger_wallet == w
                                || gate.opponent_wallet.as_deref() == Some(w.as_str());
                            if !in_duel {
                                // Same "not found" framing duels.rs uses for a
                                // mismatched invited_wallet — don't confirm the
                                // duel exists to a wallet that isn't in it.
                                tracing::warn!("arena_ws: join rejected, wallet {} is not on duel {}", w, j.duel_id);
                                send_err(&client_tx, "Duel not found");
                                continue;
                            }

                            tracing::info!("arena_ws: {} joined duel {}", w, j.duel_id);
                            wallet = Some(w.clone());
                            let entry = ClientEntry {
                                duel_id: j.duel_id,
                                wallet: w,
                                name: String::new(), // display name is cosmetic; filled client-side for now
                                stake_g: gate.stake_g,
                                tx: client_tx.clone(),
                            };
                            let _ = server_tx.send(ServerMsg::Join(entry));
                        }
                        ClientMsg::Input(i) => {
                            if let Some(ref w) = wallet {
                                let _ = server_tx.send(ServerMsg::Input {
                                    wallet: w.clone(),
                                    sample: InputSample {
                                        move_x: i.move_x, move_y: i.move_y,
                                        yaw: i.yaw, pitch: i.pitch,
                                        firing: i.firing, want_reload: i.want_reload,
                                        crouching: i.crouching, ads: i.ads,
                                    },
                                });
                            }
                        }
                        ClientMsg::Forfeit => {
                            if let Some(ref w) = wallet {
                                tracing::info!("arena_ws: {} sent forfeit", w);
                                let _ = server_tx.send(ServerMsg::Forfeit { wallet: w.clone() });
                            }
                        }
                    }
                }

                Message::Ping(bytes) => {
                    let _ = session.pong(&bytes).await;
                }

                Message::Close(reason) => {
                    tracing::info!("arena_ws: close frame from {:?} ({:?})", wallet, reason);
                    if let Some(ref w) = wallet {
                        let _ = server_tx.send(ServerMsg::Leave { wallet: w.clone() });
                    }
                    let _ = session.close(reason).await;
                    break;
                }

                _ => {}
            }
        }

        // Reached when msg_stream ends without an explicit Close frame — a
        // dropped connection (network loss, tab killed, mobile backgrounding)
        // looks exactly like this, which is exactly the case the 2026-08-23
        // incident needed distinguishing from "never connected at all".
        tracing::info!("arena_ws: stream ended for {:?} (no close frame)", wallet);
        if let Some(w) = wallet {
            let _ = server_tx.send(ServerMsg::Leave { wallet: w });
        }
    });

    Ok(response)
}

fn send_err(tx: &tokio::sync::mpsc::UnboundedSender<String>, msg: &str) {
    let _ = tx.send(serde_json::json!({ "type": "error", "message": msg }).to_string());
}
