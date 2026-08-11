-- Support-agent escalations.
--
-- When the agent cannot resolve something itself it writes a row here instead of
-- telling the player "message us on Telegram" and losing the context. The row is the
-- whole point: a player stuck on GoodDollar face verification is only actionable if we
-- captured WHICH wallet, WHEN, and what the agent had already established — which is
-- exactly what we did not have when GoodDollar asked us for specifics.
--
-- `transcript` is stored on the escalation rather than logging every conversation to
-- its own table on purpose: conversations that resolved themselves are not worth
-- retaining (they are player questions about their own money), and keeping only the
-- escalated ones means the table stays small and every row is one somebody must read.

CREATE TABLE IF NOT EXISTS agent_escalations (
    id              UUID PRIMARY KEY,
    -- Nullable: the highest-value escalation (stuck on the verify step) happens BEFORE
    -- a player row exists, so this is a bare wallet address with no FK to players.
    wallet_address  TEXT,
    -- Free-form but agent-supplied from a fixed set: verification, payout, wallet,
    -- gameplay, other. Used to spot a bug reported 50 times rather than 50 tickets.
    category        TEXT        NOT NULL,
    summary         TEXT        NOT NULL,
    -- The conversation up to the escalation, so a human does not have to ask again.
    transcript      JSONB,
    -- Where in the app it happened ('onboarding:verify', 'bank', …). The onboarding
    -- steps are the ones worth alerting on.
    context         TEXT,
    status          TEXT        NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The read pattern is "what is still open, newest first".
CREATE INDEX IF NOT EXISTS idx_agent_escalations_open
    ON agent_escalations (status, created_at DESC);

-- Repeat-offender lookup: is this the same wallet stuck again, or a new player?
CREATE INDEX IF NOT EXISTS idx_agent_escalations_wallet
    ON agent_escalations (LOWER(wallet_address));
