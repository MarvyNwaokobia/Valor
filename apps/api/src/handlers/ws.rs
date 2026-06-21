use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt as _;
use serde_json::json;
use serde::Deserialize;
use crate::AppState;
use crate::models::player::Player;
use crate::services::game_server::{ClientEntry, ServerMsg};
use crate::utils::{is_valid_wallet, normalize_wallet};

#[derive(Deserialize)]
struct QueueMsg {
    wallet:       String,
    name:         String,
    player_class: String,
    #[serde(default = "default_stat")]
    attack:  i32,
    #[serde(default = "default_stat")]
    defense: i32,
    #[serde(default = "default_stat")]
    speed:   i32,
}

fn default_stat() -> i32 { 10 }

#[derive(Deserialize)]
struct ActionMsg {
    room_id: String,
    action:  String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Queue(QueueMsg),
    Action(ActionMsg),
}

pub async fn battle_ws(
    req:    HttpRequest,
    stream: web::Payload,
    state:  web::Data<AppState>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    let server_tx = state.game_server.tx.clone();

    // Per-connection outbound channel: game server → this WebSocket
    let (client_tx, mut client_rx) =
        tokio::sync::mpsc::unbounded_channel::<String>();

    // Forward game-server messages to the WebSocket client
    let mut fwd_session = session.clone();
    actix_web::rt::spawn(async move {
        while let Some(msg) = client_rx.recv().await {
            if fwd_session.text(msg).await.is_err() {
                break;
            }
        }
    });

    // Process inbound WebSocket messages (msg_stream is !Send — must use actix rt)
    actix_web::rt::spawn(async move {
        let mut wallet: Option<String> = None;
        let mut room_id: Option<String> = None;

        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Text(text) => {
                    let parsed: ClientMsg = match serde_json::from_str(&text) {
                        Ok(m)  => m,
                        Err(_) => continue,
                    };
                    match parsed {
                        ClientMsg::Queue(q) => {
                            if !is_valid_wallet(&q.wallet) {
                                let _ = client_tx.send(json!({
                                    "type": "error",
                                    "message": "Invalid wallet address"
                                }).to_string());
                                continue;
                            }

                            let normalized_wallet = normalize_wallet(&q.wallet);
                            let player = sqlx::query_as::<_, Player>(
                                "SELECT * FROM players WHERE wallet_address = $1",
                            )
                            .bind(&normalized_wallet)
                            .fetch_optional(&state.db)
                            .await
                            .ok()
                            .flatten();

                            let Some(player) = player else {
                                let _ = client_tx.send(json!({
                                    "type": "error",
                                    "message": "Player not found"
                                }).to_string());
                                continue;
                            };

                            wallet = Some(normalized_wallet.clone());
                            let entry = ClientEntry {
                                wallet:       normalized_wallet,
                                name:         player.character_name,
                                player_class: player.character_class.unwrap_or_else(|| "Berserker".into()),
                                attack:       player.attack_stat,
                                defense:      player.defense_stat,
                                speed:        player.speed_stat,
                                tx:           client_tx.clone(),
                            };
                            let _ = server_tx.send(ServerMsg::Join(entry));
                        }
                        ClientMsg::Action(a) => {
                            room_id = Some(a.room_id.clone());
                            if let Some(ref w) = wallet {
                                let _ = server_tx.send(ServerMsg::Action {
                                    wallet:  w.clone(),
                                    room_id: a.room_id,
                                    action:  a.action,
                                });
                            }
                        }
                    }
                }

                Message::Ping(bytes) => {
                    let _ = session.pong(&bytes).await;
                }

                Message::Close(reason) => {
                    if let Some(ref w) = wallet {
                        let _ = server_tx.send(ServerMsg::Leave { wallet: w.clone() });
                    }
                    let _ = session.close(reason).await;
                    break;
                }

                _ => {}
            }
        }

        // Client disconnected without sending Close frame
        if let Some(w) = wallet {
            let _ = server_tx.send(ServerMsg::Leave { wallet: w });
        }
        let _ = room_id;
    });

    Ok(response)
}
