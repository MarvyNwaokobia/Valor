//! Chat presence socket — `GET /ws/chat`. Same two-task structure as
//! `handlers/ws.rs::battle_ws` (actix-ws session + a forward task + an inbound
//! task), but the protocol is much smaller: the client sends one `hello` to
//! register which wallet this connection belongs to, and after that only
//! receives (`new_message` events pushed by `handlers/chat.rs::send_message`).
//! Actual sending goes through the REST endpoint, not this socket — see the
//! comment on `handlers::chat::send_message` for why.

use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt as _;
use serde::Deserialize;
use crate::services::chat_hub;
use crate::utils::{is_valid_wallet, normalize_wallet};
use crate::AppState;

#[derive(Deserialize)]
struct HelloMsg {
    wallet: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Hello(HelloMsg),
}

pub async fn chat_ws(
    req:    HttpRequest,
    stream: web::Payload,
    state:  web::Data<AppState>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    let hub = state.chat_hub.clone();

    let (client_tx, mut client_rx) =
        tokio::sync::mpsc::unbounded_channel::<String>();

    let mut fwd_session = session.clone();
    actix_web::rt::spawn(async move {
        while let Some(msg) = client_rx.recv().await {
            if fwd_session.text(msg).await.is_err() {
                break;
            }
        }
    });

    actix_web::rt::spawn(async move {
        let mut registered: Option<(String, uuid::Uuid)> = None;

        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Text(text) => {
                    let parsed: ClientMsg = match serde_json::from_str(&text) {
                        Ok(m)  => m,
                        Err(_) => continue,
                    };
                    match parsed {
                        ClientMsg::Hello(h) => {
                            if !is_valid_wallet(&h.wallet) {
                                continue;
                            }
                            let wallet = normalize_wallet(&h.wallet);
                            // A reconnect (or a stray double hello) shouldn't leak the
                            // previous registration for this connection.
                            if let Some((old_wallet, old_id)) = registered.take() {
                                chat_hub::unregister(&hub, &old_wallet, old_id);
                            }
                            let conn_id = chat_hub::register(&hub, &wallet, client_tx.clone());
                            registered = Some((wallet, conn_id));
                        }
                    }
                }

                Message::Ping(bytes) => {
                    let _ = session.pong(&bytes).await;
                }

                Message::Close(reason) => {
                    if let Some((wallet, conn_id)) = registered.take() {
                        chat_hub::unregister(&hub, &wallet, conn_id);
                    }
                    let _ = session.close(reason).await;
                    break;
                }

                _ => {}
            }
        }

        if let Some((wallet, conn_id)) = registered {
            chat_hub::unregister(&hub, &wallet, conn_id);
        }
    });

    Ok(response)
}
