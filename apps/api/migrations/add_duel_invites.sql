-- Targeted duel invites — "challenge this friend" instead of "open to anyone".
--
-- Every duel up to now is opened for anyone to accept (see add_duels.sql:
-- opponent_wallet starts NULL and any wallet but the challenger's can claim it).
-- A friend challenge needs the opposite: reserved for ONE specific wallet until
-- they act on it. `invited_wallet` is that reservation. NULL keeps today's
-- behaviour (open to anyone) so nothing about existing duels changes.
ALTER TABLE duels ADD COLUMN IF NOT EXISTS invited_wallet TEXT;

-- The lobby's public "open" list must exclude invited duels, or a friend
-- challenge would still be visible (and stake-able, right up until the accept
-- check rejects it) to everyone else — this is what the app-side query filters
-- on to keep a targeted challenge actually private to its invitee.
CREATE INDEX IF NOT EXISTS idx_duels_invited ON duels (invited_wallet) WHERE invited_wallet IS NOT NULL;
