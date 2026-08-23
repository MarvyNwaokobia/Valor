//! WS transport for co-op Endless parties — `GET /ws/coop`.
//!
//! Boilerplate mirrors `arena_ws.rs` almost exactly, minus the one thing
//! that made that file more than plumbing: there is no DB gate here. A
//! co-op party has no `duels` row — no row at all, see
//! `coop_server.rs`'s module doc — so the only check on a wallet is that
//! it's well-formed. Nothing is staked, so there's nothing worth spoofing.

use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt as _;
use serde::Deserialize;
use serde_json::Value;
use crate::AppState;
use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::services::coop_server::ServerMsg;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    CreateParty { wallet: String, #[serde(default)] name: String },
    JoinParty { code: String, wallet: String, #[serde(default)] name: String },
    StartRun,
    /// The host's `sim.snapshot()` — an opaque blob to this server, see
    /// `coop_server.rs`'s module doc. Only meaningful from the host's own
    /// connection; the server enforces that, not this handler.
    HostState { snapshot: Value },
    /// A non-host player's position/aim/fire-intent — same "opaque to the
    /// server" treatment as `HostState`.
    RemoteInput { payload: Value },
    WaveCleared { wave: u32 },
    Leave,
}

pub async fn coop_ws(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<AppState>,
) -> Result<HttpResponse, actix_web::Error> {
    tracing::info!("coop_ws: upgrade request from {:?}", req.peer_addr());
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    let server_tx = state.coop_server.tx.clone();

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
                        ClientMsg::CreateParty { wallet: w, name } => {
                            if !is_valid_wallet(&w) {
                                send_err(&client_tx, "Invalid wallet address");
                                continue;
                            }
                            let w = normalize_wallet(&w);
                            tracing::info!("coop_ws: {} creating a party", w);
                            wallet = Some(w.clone());
                            let _ = server_tx.send(ServerMsg::CreateParty { wallet: w, name, tx: client_tx.clone() });
                        }
                        ClientMsg::JoinParty { code, wallet: w, name } => {
                            if !is_valid_wallet(&w) {
                                send_err(&client_tx, "Invalid wallet address");
                                continue;
                            }
                            let w = normalize_wallet(&w);
                            let code = code.trim().to_uppercase();
                            tracing::info!("coop_ws: {} joining party {}", w, code);
                            wallet = Some(w.clone());
                            let _ = server_tx.send(ServerMsg::JoinParty { code, wallet: w, name, tx: client_tx.clone() });
                        }
                        ClientMsg::StartRun => {
                            if let Some(ref w) = wallet {
                                let _ = server_tx.send(ServerMsg::StartRun { wallet: w.clone() });
                            }
                        }
                        ClientMsg::HostState { snapshot } => {
                            if let Some(ref w) = wallet {
                                let _ = server_tx.send(ServerMsg::HostState { wallet: w.clone(), snapshot });
                            }
                        }
                        ClientMsg::RemoteInput { payload } => {
                            if let Some(ref w) = wallet {
                                let _ = server_tx.send(ServerMsg::RemoteInput { wallet: w.clone(), payload });
                            }
                        }
                        ClientMsg::WaveCleared { wave } => {
                            if let Some(ref w) = wallet {
                                let _ = server_tx.send(ServerMsg::WaveCleared { wallet: w.clone(), wave });
                            }
                        }
                        ClientMsg::Leave => {
                            if let Some(ref w) = wallet {
                                let _ = server_tx.send(ServerMsg::Leave { wallet: w.clone() });
                            }
                        }
                    }
                }

                Message::Ping(bytes) => {
                    let _ = session.pong(&bytes).await;
                }

                Message::Close(reason) => {
                    tracing::info!("coop_ws: close frame from {:?} ({:?})", wallet, reason);
                    if let Some(ref w) = wallet {
                        let _ = server_tx.send(ServerMsg::Leave { wallet: w.clone() });
                    }
                    let _ = session.close(reason).await;
                    break;
                }

                _ => {}
            }
        }

        tracing::info!("coop_ws: stream ended for {:?} (no close frame)", wallet);
        if let Some(w) = wallet {
            let _ = server_tx.send(ServerMsg::Leave { wallet: w });
        }
    });

    Ok(response)
}

fn send_err(tx: &tokio::sync::mpsc::UnboundedSender<String>, msg: &str) {
    let _ = tx.send(serde_json::json!({ "type": "error", "message": msg }).to_string());
}
