-- Season prize restricted to one group (2026-11-07)
--
-- A season is open to everyone, but its prize can be paid to the members of one
-- group only (e.g. a partner event where the pool belongs to that community).
-- NULL = the ordinary season: the overall top ranks are paid.
--
-- Only WHO IS PAID changes. Play, the public board and scoring are untouched, so
-- there is still exactly one scoring system. Set before the payout is computed;
-- once season_payouts rows exist the winners are committed and this is frozen.
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS payout_group_id UUID REFERENCES player_groups(id) ON DELETE SET NULL;
