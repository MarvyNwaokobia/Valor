# B0 — XP≠G$ decoupling + first-clear bounties (deploy runbook)

> **Money-touching. Nothing here is live until you run these steps.** The code is
> committed but inert: prod behaviour only changes after the contract upgrade,
> the migration, and the API redeploy below. Do them in this order.

## What changed (and why)

Before B0, **every XP rank-up minted G$ on-chain** (Silver 20 → Diamond 150). XP was
a G$ faucet — grind XP, print money. B0 breaks that:

- **XP is now pure progression/unlocks.** Ranking up still records on-chain + enrolls
  in the rank pool, but mints **no G$**.
- **G$ comes from one-time first-clear bounties.** Clearing a Campaign op for the
  first time pays a capped bounty on-chain (ordinary ops 2 G$, bosses on op 5/10/15
  pay 10/15/25). A full campaign = ~74 G$, paid once — not repeatable.
- **Idempotent two ways:** a `first_clear_bounties (wallet, level)` PK owns each
  payout in the DB, and `ValorRewardPool.distributeReward(player, amount, ref)`
  refuses to pay the same `ref` twice on-chain. A retry or double-submit cannot
  double-pay.

Daily GoodDollar UBI claim (5 G$/day) is untouched — that's UBI, not the XP faucet.

## Deploy steps

### 1. Upgrade the ValorRewardPool proxy (adds `distributeReward`)

UUPS upgrade, append-only storage + one new function, **no reinitializer**.

```bash
cd contracts
# .env needs DEPLOYER_PRIVATE_KEY (proxy OWNER), REWARD_POOL_CONTRACT (proxy addr),
# CELO_RPC_URL=https://forno.celo.org
forge script script/UpgradeRewardPool.s.sol --rpc-url $CELO_RPC_URL --broadcast --verify
```

Verify: `cast call $REWARD_POOL_CONTRACT "MAX_REWARD()(uint256)" --rpc-url $CELO_RPC_URL`
should return `500000000000000000000` (500e18).

> **Status: DONE + VERIFIED (2026-07-12).** The proxy is upgraded, the migration is
> applied to prod Postgres, and a first-clear bounty was confirmed paying on-chain
> end-to-end. The steps below are the runbook for a fresh environment.

### 2. Run the migration (Railway prod Postgres)

```bash
# DATABASE_URL = the Railway Postgres connection string (direct — no pooler)
psql "$DATABASE_URL" < apps/api/migrations/add_first_clear_bounties.sql
```

It's also in `scripts/bootstrap-neon.mjs`, so a fresh bootstrap includes it. Run it
against the local Supabase sandbox too if you test locally.

### 3. Fund the pool (if low)

`distributeReward` pays from the pool's G$ balance. Check
`cast call $REWARD_POOL_CONTRACT "poolBalance()(uint256)"`; top up if needed so
bounties can actually pay out. On failure the bounty row is marked `failed` and the
`/battles/bounties/reconcile` cron re-attempts it (idempotent via the on-chain ref).

### 4. Redeploy the API (Railway — auto-deploys on push to `main`)

Railway rebuilds `apps/api/Dockerfile` automatically on push. `REWARD_POOL_CONTRACT`
must be set in the Railway env (no code fallback — unset means bounties silently fail).

The backend signer wallet must be the pool's `backendSigner` (already the case for the
existing rank-up/daily-claim payouts — same signer).

## Verify live

- Clear op 1 on a fresh account → `POST /battles/fight/complete` returns
  `"bounty_awarded": 2`, `first_clear: true`; the on-chain balance rises ~2 G$.
- Re-clear op 1 → `first_clear: false`, `bounty_awarded: 0` (pve_level already past it).
- Rank up from grinding → `g_awarded: 0` (no faucet).

## Notes / follow-ups

- **Failed payouts:** if the chain call fails (RPC blip, pool empty), the bounty row is
  marked `status='failed'` and logged. It will **not** auto-retry (pve_level already
  advanced). A small reconcile job that re-attempts `failed` rows is a good B-track
  follow-up; the on-chain `ref` guard makes re-attempts safe (can't double-pay).
- Bounty amounts live in `first_clear_bounty(level)` in `apps/api/src/handlers/battles.rs`
  — tune freely, all must stay ≤ `MAX_REWARD` (500 G$).
- This is the B0 foundation. Next: B1 sinks (marketplace/Survival re-arm), B2 endless
  Gauntlet score submission, B3 seasons + payout.
