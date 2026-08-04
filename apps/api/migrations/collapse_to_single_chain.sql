-- Collapse the schema back to a single chain.
--
-- Valor runs on Celo. The schema had grown room for a second one: per-chain item
-- pricing, an accrue-then-claim balance banked separately from G$, and a chain
-- column on duels. None of it is reachable from the application any more, so it
-- comes out — a schema describing capabilities the code does not have is a schema
-- that misleads whoever reads it next.
--
-- ⚠️ THIS DESTROYS DATA AND CANNOT BE UNDONE
-- `earnings` and `claims` held accrued balances denominated in a token with no
-- exchange rate and no cash-out path, so nothing of monetary value is destroyed —
-- but the rows do not come back. Take a dump first if the accrual history is
-- wanted for reporting.
--
-- Nothing here touches Celo. `g_ledger.chain_id` keeps its Celo default and every
-- Celo row, so reported G$ volume is unchanged.

-- ── Per-chain item pricing ────────────────────────────────────────────────────
-- `items.price_g` was always the Celo price and is untouched, so the shop keeps
-- working exactly as it did.
DROP TABLE IF EXISTS item_chain_prices;

-- ── Accrue-then-claim balances ────────────────────────────────────────────────
-- `earnings` first: it carries the FK onto `claims`.
DROP TABLE IF EXISTS earnings;
DROP TABLE IF EXISTS claims;

-- ── Duels go back to one chain ────────────────────────────────────────────────
-- The stake-tx columns recorded deposits into an escrow contract that no longer
-- exists. Celo duels record their settlement in `payout_tx`, which stays.
ALTER TABLE duels DROP COLUMN IF EXISTS chain_id;
ALTER TABLE duels DROP COLUMN IF EXISTS challenger_stake_tx;
ALTER TABLE duels DROP COLUMN IF EXISTS opponent_stake_tx;

-- Both of these named chain_id and die with the column, but DROP COLUMN only
-- removes an index if the column is actually there — on a fresh database the
-- ALTERs above are no-ops, so drop them by name too.
DROP INDEX IF EXISTS idx_duels_open_by_chain;
DROP INDEX IF EXISTS idx_duels_one_open_per_challenger_chain;

-- One open duel per challenger, full stop. Partial on `status = 'open'` so
-- resolved and cancelled history does not collide with it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_duels_one_open_per_challenger
    ON duels (challenger_wallet)
    WHERE status = 'open';

-- ── Rows naming a chain the code can no longer resolve ────────────────────────
-- `ChainId::from_i32` recognises Celo and nothing else now, so these rows describe
-- a chain nothing can name. None of them are G$-denominated, so removing them does
-- not change a single figure in any report.
DELETE FROM battle_chain_records WHERE chain_id <> 42220;
DELETE FROM g_ledger             WHERE chain_id <> 42220;

-- ── Editions ──────────────────────────────────────────────────────────────────
-- The CHECK advertised a third edition that never shipped and can no longer be
-- built. Any row somehow holding it becomes 'web', matching how services::edition
-- parses an unrecognised value.
UPDATE players SET edition = 'web' WHERE edition NOT IN ('web', 'minipay');

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_edition_check;
ALTER TABLE players ADD CONSTRAINT players_edition_check
  CHECK (edition IN ('web', 'minipay'));
