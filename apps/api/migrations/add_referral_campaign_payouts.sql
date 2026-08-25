-- Referral campaign prize pool + payout, mirroring add_season_payouts.sql.
--
-- Referrals stopped paying G$ directly (see credit_referral in players.rs) — a
-- referral is recorded the moment it happens, unconditionally, and money only
-- moves when an admin closes a campaign and runs its payout: the same top-heavy
-- split across the campaign's referral leaderboard that seasons already use.
-- Same idempotent rail as season payouts: PK on (campaign, wallet) makes
-- computing winners a no-op on re-run, and each on-chain transfer carries its
-- own ref so a resumed payout only retries what did not land.
ALTER TABLE referral_campaigns ADD COLUMN IF NOT EXISTS prize_pool_g  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE referral_campaigns ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'pending';
-- This campaign's own split in basis points by rank; NULL = the seasons default table.
ALTER TABLE referral_campaigns ADD COLUMN IF NOT EXISTS payout_bps INTEGER[];

CREATE TABLE IF NOT EXISTS referral_campaign_payouts (
  campaign_id     UUID NOT NULL REFERENCES referral_campaigns (id) ON DELETE CASCADE,
  wallet_address  TEXT NOT NULL REFERENCES players (wallet_address) ON DELETE CASCADE,
  rank            INT NOT NULL,
  referral_count  INT NOT NULL,
  amount_g        BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  tx_hash         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_referral_campaign_payouts_campaign ON referral_campaign_payouts (campaign_id);
