-- Web Push subscriptions (VAPID) — one row per browser/device a player has opted into
-- notifications on. `endpoint` is unique because the browser mints a fresh one per
-- registration; re-subscribing on the same device (permission re-granted, SW reset)
-- lands as an ON CONFLICT upsert rather than a duplicate row.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address    TEXT NOT NULL REFERENCES players (wallet_address) ON DELETE CASCADE,
  endpoint          TEXT NOT NULL UNIQUE,
  p256dh            TEXT NOT NULL,
  auth              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Last time the daily sweep actually sent this subscription a notification —
  -- the gate that stops a slow/duplicate cron run from double-sending same-day.
  last_notified_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_wallet ON push_subscriptions (wallet_address);
