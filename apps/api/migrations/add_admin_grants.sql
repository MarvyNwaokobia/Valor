-- One-off G$ grants to a player from the main reward pool — bounties, external
-- challenge prizes, community rewards. Not tied to any in-game action, so it
-- needs its own idempotent ledger the way referrals and season payouts do:
-- PRIMARY KEY (wallet_address, reason) makes re-submitting the same grant
-- request a no-op instead of a double pay.
CREATE TABLE IF NOT EXISTS admin_grants (
  wallet_address TEXT   NOT NULL REFERENCES players (wallet_address) ON DELETE CASCADE,
  reason         TEXT   NOT NULL,
  amount_g       BIGINT NOT NULL,
  status         TEXT   NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'failed')),
  tx_hash        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, reason)
);

CREATE INDEX IF NOT EXISTS idx_admin_grants_status ON admin_grants (status);
