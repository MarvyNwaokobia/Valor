-- Identity verification as its own counted checkpoint (2026-08-26), separate
-- from becoming a player.
--
-- Before this, "verified with GoodDollar through Valor" left no record at all
-- unless the wallet went on to claim a character — POST /players is the only
-- thing that ever wrote a row, and it happens well after verification, on a
-- different onboarding step (confirm, not verify). Someone who verified and
-- then closed the tab was invisible everywhere: no DB row, no on-chain trace.
--
-- No FK to players on purpose: the whole point is capturing wallets that may
-- NEVER become a players row.
CREATE TABLE IF NOT EXISTS identity_verifications (
    wallet_address TEXT PRIMARY KEY,
    verified_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set once the recordVerification() on-chain write lands; NULL if it never
    -- did (relay gas dry, RPC blip). The DB row itself is the source of truth
    -- for "did this wallet verify" — the chain tx is a secondary, best-effort
    -- trace for Dune, not a precondition for counting them.
    chain_tx       TEXT
);
