-- Friends chat: 1:1 messages between two players. Deliberately gated to
-- accepted friendships at the handler layer (see handlers/chat.rs), not here —
-- the table itself just stores the thread, same way `friendships` doesn't know
-- about duels.
CREATE TABLE IF NOT EXISTS chat_messages (
    id                UUID PRIMARY KEY,
    sender_wallet     TEXT NOT NULL,
    recipient_wallet  TEXT NOT NULL,
    body              TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at           TIMESTAMPTZ,

    CONSTRAINT chat_messages_no_self CHECK (sender_wallet <> recipient_wallet)
);

-- A thread's history is read by the unordered pair, newest first — LEAST/GREATEST
-- normalise the two wallets into the index the same way idx_friendships_unique_pair
-- does, so "A's messages with B" and "B's messages with A" hit the same index range.
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
    ON chat_messages (LEAST(sender_wallet, recipient_wallet), GREATEST(sender_wallet, recipient_wallet), created_at DESC);

-- Fast unread-count-per-sender lookups for the recipient's badge.
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
    ON chat_messages (recipient_wallet) WHERE read_at IS NULL;
