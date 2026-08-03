-- Backfill Scrip for campaign clears that happened before Scrip existed.
--
-- THE PROBLEM THIS SOLVES
-- Scrip went live on Avalanche on 2 Aug 2026 and accrues 100 per campaign clear
-- (SCRIP_PER_CLEAR in handlers/battles.rs). Every clear before that date earned
-- nothing, because there was nothing to earn. The result is an economy with
-- 100 SCRP in existence across one wallet: a marketplace with no buyers and a
-- duel ladder with nobody able to enter it. The rails were built and had no
-- traffic, and the reason was arithmetic rather than product.
--
-- WHY first_clear_bounties IS THE SOURCE OF TRUTH
-- One row per (wallet, level) the first time a player clears it, which is exactly
-- the event Scrip pays for. All 325 rows are status 'paid', but status is
-- deliberately NOT filtered on: it records what the G$ bounty did, and a clear
-- the player achieved is a clear whether or not a payment succeeded afterwards.
-- Paying Scrip on the achievement rather than on the payment is both fairer and
-- the same rule the live code follows.
--
-- WHY THIS IS SAFE TO RUN TWICE
-- `ref` uses the identical format the live path writes
-- (`first_clear:{wallet}:{level}`, see award_scrip_for_clear), and `earnings` has
-- a UNIQUE index on (wallet_address, ref). ON CONFLICT DO NOTHING therefore makes
-- this idempotent against itself AND against the three rows the live code has
-- already written. A player cannot be paid twice for one clear, and a rerun
-- awards nothing.
--
-- WHAT THIS DOES NOT DO
-- It does not mint anything. These are accrued balances, the same shape the live
-- code produces; players turn them into on-chain SCRP by claiming at the Bank.
-- Nothing here spends relay gas, and nothing here can fail on-chain.
--
-- EXPECTED EFFECT (measured 2026-08-03): 322 rows, 58 wallets, 32,200 SCRP.
-- Distribution: 23 wallets at 100, 19 at 200, 16 at 1,500, plus two mid-range.
-- That is enough for the 10-500 duel ladder to be enterable and for the shop's
-- cheapest tiers to be reachable.

INSERT INTO earnings (wallet_address, chain_id, category, amount, ref)
SELECT
    b.wallet_address,
    43114,                       -- Avalanche C-Chain; Scrip does not exist on Celo
    'first_clear',
    100,                         -- SCRIP_PER_CLEAR, kept in step with battles.rs
    'first_clear:' || b.wallet_address || ':' || b.level
FROM first_clear_bounties b
ON CONFLICT (wallet_address, ref) DO NOTHING;
