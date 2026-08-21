-- Friends: opt-in social graph, deliberately separate from referrals.
--
-- A referral pays out once for bringing in a new verified player and says
-- nothing about who anyone wants to stay connected to — so friendship is never
-- inferred from a referral. It is always a request the RECIPIENT accepts.
--
-- One row per relationship, keyed by an ordered (requester, recipient) pair
-- while pending, but a friendship itself is undirected once accepted — the
-- unique index below blocks the mirror row (B->A) while A->B exists in any
-- status, so two people can't end up with two rows describing one relationship.
CREATE TABLE IF NOT EXISTS friendships (
    id               UUID PRIMARY KEY,
    requester_wallet TEXT NOT NULL,
    recipient_wallet TEXT NOT NULL,
    -- pending -> accepted. A decline (or an unfriend) DELETES the row rather
    -- than parking it in a 'declined' state, so the same two players are free
    -- to try again later instead of being permanently blocked by one no.
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at     TIMESTAMPTZ,

    CONSTRAINT friendships_no_self CHECK (requester_wallet <> recipient_wallet)
);

-- Fast "my friends" / "my incoming requests" reads from either side of the pair.
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_wallet, status);
CREATE INDEX IF NOT EXISTS idx_friendships_recipient ON friendships (recipient_wallet, status);

-- At most one LIVE relationship per unordered pair. LEAST/GREATEST normalise the
-- pair so A->B and B->A collide on the same index entry, which is what stops a
-- friend request being sent in both directions at once and turning into two
-- independent rows. Declines/unfriends delete their row, so this never blocks a
-- later re-request the way a permanent constraint would.
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_unique_pair
    ON friendships (LEAST(requester_wallet, recipient_wallet), GREATEST(requester_wallet, recipient_wallet));
