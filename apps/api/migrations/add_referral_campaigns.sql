-- Referral Campaign leaderboard (2026-08-23)
--
-- A time-boxed window over the existing `referrals` table, not a new payout
-- path: a campaign is just a (name, starts_at, ends_at) row, and its board is
-- COUNT(*) of referrals whose created_at falls inside that window. Referrals
-- itself is untouched, and a future campaign is just another row (or
-- POST /admin/campaigns/referrals) — no redeploy required to relaunch this.
CREATE TABLE IF NOT EXISTS referral_campaigns (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT NOT NULL,
    starts_at  TIMESTAMPTZ NOT NULL,
    ends_at    TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE referral_campaigns DROP CONSTRAINT IF EXISTS referral_campaigns_window;
ALTER TABLE referral_campaigns ADD CONSTRAINT referral_campaigns_window
    CHECK (ends_at > starts_at);

CREATE INDEX IF NOT EXISTS idx_referral_campaigns_window ON referral_campaigns (starts_at, ends_at);

-- Launch week: Mon 24 Aug 2026 00:00 -> Sun 30 Aug 2026 23:59:59, West Africa Time.
INSERT INTO referral_campaigns (name, starts_at, ends_at)
SELECT 'Launch Week Referral Campaign', '2026-08-24 00:00:00+01'::timestamptz, '2026-08-30 23:59:59+01'::timestamptz
WHERE NOT EXISTS (SELECT 1 FROM referral_campaigns WHERE name = 'Launch Week Referral Campaign');
