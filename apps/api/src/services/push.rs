use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use web_push::{
    ContentEncoding, IsahcWebPushClient, PartialVapidSignatureBuilder, SubscriptionInfo,
    WebPushClient, WebPushError, WebPushMessageBuilder,
};

/// Payload shape delivered to the service worker's `push` handler
/// (apps/web/src/app/sw.ts). Kept minimal — the SW decides icon/badge/actions.
#[derive(Serialize)]
pub struct PushPayload<'a> {
    pub title: &'a str,
    pub body: &'a str,
    /// Path the notification opens on click, e.g. "/hub".
    pub url: &'a str,
}

#[derive(Clone)]
pub struct PushService {
    // Built once from the VAPID private key and reused per-message with each
    // subscription's own info (`from_base64_no_sub`), rather than re-parsing the
    // key on every send.
    vapid: PartialVapidSignatureBuilder,
    subject: String,
    client: IsahcWebPushClient,
}

/// A push subscription is gone for good (404/410 from the push service — the user
/// uninstalled, revoked permission, or the browser rotated the endpoint). The caller
/// should delete the row rather than retry it.
pub struct SendOutcome {
    pub expired: bool,
}

impl PushService {
    pub fn from_env() -> Result<Self> {
        let private_key = std::env::var("VAPID_PRIVATE_KEY")
            .map_err(|_| anyhow!("VAPID_PRIVATE_KEY not set"))?;
        let subject = std::env::var("VAPID_SUBJECT")
            .unwrap_or_else(|_| "mailto:support@playvalor.app".into());

        let vapid = web_push::VapidSignatureBuilder::from_base64_no_sub(&private_key)
            .map_err(|e| anyhow!("Invalid VAPID_PRIVATE_KEY: {}", e))?;

        let client = IsahcWebPushClient::new().map_err(|e| anyhow!("web push client: {}", e))?;

        Ok(Self { vapid, subject, client })
    }

    /// The `applicationServerKey` the frontend passes to
    /// `PushManager.subscribe()` — derived from the same private key that signs
    /// outgoing messages, so it can never drift out of sync with it.
    pub fn public_key_base64(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.vapid.get_public_key())
    }

    pub async fn send(
        &self,
        endpoint: &str,
        p256dh: &str,
        auth: &str,
        payload: &PushPayload<'_>,
    ) -> Result<SendOutcome> {
        let subscription = SubscriptionInfo::new(endpoint, p256dh, auth);

        let mut sig_builder = self.vapid.clone().add_sub_info(&subscription);
        sig_builder.add_claim("sub", self.subject.clone());
        let signature = sig_builder
            .build()
            .map_err(|e| anyhow!("vapid signature: {}", e))?;

        let body = serde_json::to_vec(payload)?;

        let mut builder = WebPushMessageBuilder::new(&subscription);
        builder.set_payload(ContentEncoding::Aes128Gcm, &body);
        builder.set_vapid_signature(signature);
        // Best-effort reminder, not a transactional alert — no reason to make the push
        // service hold or retry it past a day.
        builder.set_ttl(86_400);

        let message = builder.build().map_err(|e| anyhow!("build push message: {}", e))?;

        match self.client.send(message).await {
            Ok(()) => Ok(SendOutcome { expired: false }),
            // The push service itself is telling us the subscription no longer exists.
            Err(WebPushError::EndpointNotValid(_)) | Err(WebPushError::EndpointNotFound(_)) => {
                Ok(SendOutcome { expired: true })
            }
            Err(e) => Err(anyhow!("push send failed: {}", e)),
        }
    }
}

#[derive(sqlx::FromRow)]
struct Subscription {
    id: uuid::Uuid,
    endpoint: String,
    p256dh: String,
    auth: String,
}

/// Push one message to every device a wallet has subscribed from — the
/// event-triggered counterpart to the daily sweep in handlers/push.rs, for
/// things that should notify the moment they happen (a friend request, a
/// duel challenge) rather than waiting for the next cron tick.
///
/// Best-effort: a send failure is logged and the loop continues rather than
/// failing the request that triggered it, and an expired endpoint (410/404
/// from the push service) is deleted on the spot, same cleanup the sweep does.
pub async fn notify_wallet(
    db: &sqlx::PgPool,
    push: &PushService,
    wallet: &str,
    payload: &PushPayload<'_>,
) {
    let subs: Vec<Subscription> = sqlx::query_as(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE wallet_address = $1",
    )
    .bind(wallet)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    for sub in subs {
        match push.send(&sub.endpoint, &sub.p256dh, &sub.auth, payload).await {
            Ok(outcome) if outcome.expired => {
                let _ = sqlx::query("DELETE FROM push_subscriptions WHERE id = $1")
                    .bind(sub.id)
                    .execute(db)
                    .await;
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("event push to {} failed: {}", wallet, e),
        }
    }
}

/// Fire an event-triggered push off the request path — a friend request, an
/// accept, a duel challenge. The caller returns to the client immediately;
/// this finishes independently and never fails the request that triggered it.
/// A no-op if push isn't configured, same as every other push call site.
pub fn notify(state: &crate::AppState, wallet: String, body: String, url: &'static str) {
    let Some(push) = state.push.clone() else { return };
    let db = state.db.clone();
    tokio::spawn(async move {
        let payload = PushPayload { title: "Valor", body: &body, url };
        notify_wallet(&db, &push, &wallet, &payload).await;
    });
}
