-- Tracks the on-chain tx hash for the AttemptStarted event recorded when a
-- Gauntlet run begins (see ValorGameRecord.recordAttempt). One start per run,
-- so a plain nullable column — not a join table like battle_chain_records,
-- which exists for multichain attribution the project has since collapsed
-- out of (see collapse_to_single_chain.sql).
ALTER TABLE survival_runs ADD COLUMN IF NOT EXISTS start_chain_tx TEXT;
