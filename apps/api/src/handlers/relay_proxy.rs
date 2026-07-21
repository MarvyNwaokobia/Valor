use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::{SinkExt, StreamExt};

// Transparent WebSocket proxy to the WalletConnect relay.
//
// WHY: many mobile carriers/ISPs can't resolve `relay.walletconnect.*`, so the
// external-wallet (WalletConnect) login is dead on mobile — the platform this game is
// mostly played on. This endpoint lives on our own always-reachable domain; the frontend
// is shimmed (lib/wcRelayProxy.ts) to open its relay socket HERE, and we forward the bytes
// to the real relay. The client still SIGNS its relay auth token for
// `relay.walletconnect.org` (so the token's `aud` stays valid) — we only move the
// transport, never touch the payload. Everything the client sends (auth JWT, projectId,
// ua) rides in the query string and is forwarded verbatim to the relay's root.

const UPSTREAM: &str = "wss://relay.walletconnect.org";

enum WsMsg {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close,
}

pub async fn wc_relay_proxy(
    req:    HttpRequest,
    stream: web::Payload,
) -> Result<HttpResponse, actix_web::Error> {
    let q = req.query_string();
    let upstream_url = if q.is_empty() {
        format!("{UPSTREAM}/")
    } else {
        format!("{UPSTREAM}/?{q}")
    };

    // Forward the browser's Origin to the relay so Reown's domain check (playvalor.app is
    // allowlisted) sees the real origin, not our server. Both crates use http 0.2.
    let origin = req.headers().get("origin").cloned();

    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;

    // client → upstream, and upstream → client, bridged over channels so the !Send actix
    // WS halves and the Send tokio-tungstenite halves never have to touch directly.
    let (c2u_tx, mut c2u_rx) = tokio::sync::mpsc::unbounded_channel::<WsMsg>();
    let (u2c_tx, mut u2c_rx) = tokio::sync::mpsc::unbounded_channel::<WsMsg>();

    // ── Upstream half (Send): connect to the real relay + pump both directions ──
    tokio::spawn(async move {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        use tokio_tungstenite::tungstenite::Message as T;

        let mut request = match upstream_url.as_str().into_client_request() {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("wc-relay-proxy: bad upstream url: {e}");
                let _ = u2c_tx.send(WsMsg::Close);
                return;
            }
        };
        if let Some(origin) = origin {
            request.headers_mut().insert("origin", origin);
        }

        let ws = match tokio_tungstenite::connect_async(request).await {
            Ok((ws, _resp)) => ws,
            Err(e) => {
                tracing::warn!("wc-relay-proxy: upstream connect failed: {e}");
                let _ = u2c_tx.send(WsMsg::Close);
                return;
            }
        };
        let (mut up_tx, mut up_rx) = ws.split();

        // client → upstream
        let pump_out = tokio::spawn(async move {
            while let Some(m) = c2u_rx.recv().await {
                let sent = match m {
                    WsMsg::Text(t)   => up_tx.send(T::Text(t)).await,
                    WsMsg::Binary(b) => up_tx.send(T::Binary(b)).await,
                    WsMsg::Ping(p)   => up_tx.send(T::Ping(p)).await,
                    WsMsg::Pong(p)   => up_tx.send(T::Pong(p)).await,
                    WsMsg::Close     => { let _ = up_tx.send(T::Close(None)).await; break; }
                };
                if sent.is_err() { break; }
            }
        });

        // upstream → client
        while let Some(msg) = up_rx.next().await {
            let fwd = match msg {
                Ok(T::Text(t))   => u2c_tx.send(WsMsg::Text(t)),
                Ok(T::Binary(b)) => u2c_tx.send(WsMsg::Binary(b)),
                Ok(T::Ping(p))   => u2c_tx.send(WsMsg::Ping(p)),
                Ok(T::Pong(p))   => u2c_tx.send(WsMsg::Pong(p)),
                Ok(T::Close(_))  => { let _ = u2c_tx.send(WsMsg::Close); break; }
                Ok(_)            => Ok(()),
                Err(_)           => { let _ = u2c_tx.send(WsMsg::Close); break; }
            };
            if fwd.is_err() { break; }
        }
        pump_out.abort();
    });

    // ── Client half (!Send): must run on the actix runtime ──
    // client → channel
    actix_web::rt::spawn(async move {
        while let Some(Ok(msg)) = msg_stream.next().await {
            let ok = match msg {
                Message::Text(t)   => c2u_tx.send(WsMsg::Text(t.to_string())),
                Message::Binary(b) => c2u_tx.send(WsMsg::Binary(b.to_vec())),
                Message::Ping(p)   => c2u_tx.send(WsMsg::Ping(p.to_vec())),
                Message::Pong(p)   => c2u_tx.send(WsMsg::Pong(p.to_vec())),
                Message::Close(_)  => { let _ = c2u_tx.send(WsMsg::Close); break; }
                _                  => Ok(()),
            };
            if ok.is_err() { break; }
        }
        let _ = c2u_tx.send(WsMsg::Close);
    });

    // channel → client
    actix_web::rt::spawn(async move {
        while let Some(m) = u2c_rx.recv().await {
            let r = match m {
                WsMsg::Text(t)   => session.text(t).await,
                WsMsg::Binary(b) => session.binary(b).await,
                WsMsg::Ping(p)   => session.ping(&p).await,
                WsMsg::Pong(p)   => session.pong(&p).await,
                WsMsg::Close     => { let _ = session.close(None).await; break; }
            };
            if r.is_err() { break; }
        }
    });

    Ok(response)
}
