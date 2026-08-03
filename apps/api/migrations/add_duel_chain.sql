-- Duels become multichain: a duel is now either a G$ duel on Celo or a SCRP duel
-- escrowed by the ValorDuel contract on Avalanche C-Chain.
--
-- WHY THE DEFAULT IS CELO AND WHY THAT IS SAFE HERE
-- Every duel that predates this column was a G$ duel, so backfilling them to 42220
-- is not a guess, it is the fact. This is the opposite situation to `g_ledger`,
-- where services/chain_id.rs deliberately refuses to let new code rely on a default
-- because a forgotten argument would silently misfile live money. Here the default
-- only ever applies to rows that already exist; the handler passes the chain
-- explicitly on every insert.

ALTER TABLE duels ADD COLUMN IF NOT EXISTS chain_id INTEGER NOT NULL DEFAULT 42220;

-- The on-chain escrow transaction for each side's stake, and the settlement tx.
-- `payout_tx` already exists and keeps its meaning (the transfer to the winner);
-- these record the two deposits that funded it, so a duel can be audited end to end
-- from the database without scanning the chain for it.
ALTER TABLE duels ADD COLUMN IF NOT EXISTS challenger_stake_tx TEXT;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS opponent_stake_tx   TEXT;

-- Duels are listed per chain: a SCRP duel must never appear in a G$ player's lobby,
-- because they cannot accept it. Every lobby query filters on chain_id and status,
-- so they belong in one index together.
CREATE INDEX IF NOT EXISTS idx_duels_open_by_chain
    ON duels (chain_id, created_at DESC)
    WHERE status = 'open';

-- The existing partial unique index allows one open duel per challenger, full stop.
-- With two chains that is wrong: it would stop a player opening a SCRP duel because
-- they have a G$ one waiting. One open duel per player PER CHAIN is the rule that
-- was actually intended.
DROP INDEX IF EXISTS idx_duels_one_open_per_challenger;
CREATE UNIQUE INDEX IF NOT EXISTS idx_duels_one_open_per_challenger_chain
    ON duels (challenger_wallet, chain_id)
    WHERE status = 'open';
