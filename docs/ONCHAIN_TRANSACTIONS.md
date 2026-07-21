# On-Chain Transaction Surface

Every listed action produces a **real transaction on Celo mainnet**. This doc is the single
source of truth for (1) what already triggers a transaction, and (2) where new transaction
volume can come from — useful both for engineering and for grant reporting that counts
on-chain activity / G$ velocity.

All contract addresses live in the README's *Smart Contracts* table. All backend writes are
serialized behind a nonce lock (`ChainWriter.tx_lock`) so concurrent fights can't collide.

---

## 1. What triggers a transaction today

### A. Backend-relay writes (relayer wallet signs + pays CELO gas, fired by gameplay)

| # | Transaction | Contract / call | Trigger | Volume shape | Code |
|---|-------------|-----------------|---------|--------------|------|
| 1 | **Record battle** | `ValorGameRecord.recordBattle` | **Every fight completion** (campaign op and PvP) | **1 per fight** — the biggest natural driver | `handlers/battles.rs:447`, `:1356` |
| 2 | **Record rank-up** | `ValorGameRecord.recordRankUp` | Crossing a rank threshold | 1 per rank-up | `handlers/battles.rs:393` |
| 3 | **Enroll in rank pool** | GoodCollective UBI pool `addMember` | Crossing a rank threshold | 1 per rank-up | `handlers/battles.rs:394` |
| 4 | **Claim character** | `ValorGameRecord.claimCharacter` | Creating / claiming a character at onboarding | 1 per player (once) | `handlers/players.rs:370` |
| 5 | **First-clear bounty** | `ValorRewardPool.distributeReward` | Clearing a campaign op for the first time | 1 per op, per player (15 ops) | `handlers/battles.rs:968` |
| 6 | **Rank-up reward** | `ValorRewardPool.distributeReward` | Every rank-up (`500 × ordinal` G$) | 1 per rank-up | `handlers/battles.rs:1038` |
| 7 | **Season payout** | `ValorRewardPool.distributeReward` | Season close, per winning wallet | 1 per winner per season | `handlers/seasons.rs:207` |
| 8 | **Endless per-wave payout** | Endless pool `distributeReward` | Each Endless wave cleared | **1 per wave** — many per run | `handlers/endless.rs:328` |

Each payout is idempotent on-chain via a deterministic `keccak256` `ref` (e.g.
`first_clear:{wallet}:{level}`, `rank_up:{wallet}:{rank}`), and reconciled by cron if a send
fails — so retries never double-pay and never fabricate volume.

### B. Player-signed permit → relay submits (relayer pays gas, gasless for the player)

| # | Transaction | Call | Trigger | Volume shape | Code |
|---|-------------|------|---------|--------------|------|
| 9 | **Marketplace purchase** | `ValorMarketplace.purchaseWithPermit` | Buying a gun / ammo / attachment / booster / field-kit | 1 per purchase | `handlers/items.rs:152` |
| 10 | **Transfer out / P2P** | G$ `permit` + `transferFrom` | Sending G$ to another wallet (Bank transfer-out) | up to 2 calls per transfer | `handlers/ledger.rs:185` |
| 11 | **Re-arm: session allowance** | G$ `permit` | Signed once at Survival run start | 1 per run | `handlers/survival.rs:100` |
| 12 | **Re-arm: spend** | G$ `transferFrom` | Each mid-run revive / restock / wave-skip | **many per run** (no new signature) | `handlers/survival.rs:201` |

### C. Player-signed direct wallet txs (P2P resale)

| # | Transaction | Call | Trigger | Code |
|---|-------------|------|---------|------|
| 13 | **List for resale** | `ValorMarketplace.listForResale` | Seller lists an owned item NFT | `hooks/useResale.ts` |
| 14 | **Operator approval** | ERC-1155 `setApprovalForAll` | One-time, before first listing | `hooks/useResale.ts` |
| 15 | **Cancel resale** | `ValorMarketplace.cancelResale` | Seller delists | `hooks/useResale.ts` |
| 16 | **Buy resale** | `ValorMarketplace.buyResaleWithPermit` | Buyer purchases a listed item (permit) | `hooks/useResale.ts` |

### D. GoodDollar protocol claims (user claims directly against GoodDollar contracts)

| # | Transaction | Trigger | Code |
|---|-------------|---------|------|
| 17 | **Daily UBI claim** | Daily Check-In → GoodDollar UBI (5 G$/day) | `hooks/*`, `lib/gooddollar.ts` |
| 18 | **Engagement rewards claim** | GoodDollar EngagementRewards `appClaim` (backend signs EIP-712, user submits) | `hooks/useEngagementRewards.ts`, `services/rewards.rs` |
| 19 | **Rank pool UBI claim** | GoodCollective UBI pool claim (⚠️ pools never funded/created in prod) | `hooks/useRankPool.ts` |

> Note: Valor's own `POST /players/{wallet}/daily-claim` endpoint is **DB-only** (it records the
> 24h cooldown). The actual UBI is a GoodDollar protocol transaction, separate from that write.

---

## 2. Where the volume actually comes from

Per genuinely-active player, ranked by transactions generated:

1. **Endless waves** (#8, #12) — 1 payout tx *per wave*, plus 1 re-arm tx per revive/restock.
   A single deep run can be dozens of txs. **Highest natural multiplier.**
2. **Fights** (#1) — 1 `recordBattle` per fight, guaranteed, every mode.
3. **Campaign progression** (#5, #6, #2, #3) — a burst as a new player clears the 15 ops and
   climbs the ladder (bounty + rank-up + record + pool-enroll each fire).
4. **Economy churn** (#9–#16) — purchases, transfers, resale, re-arm.

The lever still throttled:
- The **rank UBI pools** (#19) were never created on-chain, so that daily-drip tx never fires.

> **Endless is funded.** The Endless pool (`0xd44D…77Ba0`) holds G$; once `ENDLESS_REWARD_POOL_CONTRACT`
> is set on the host, per-wave payouts (the biggest multiplier) fire live. Enabling the rank UBI
> pools is now the remaining zero-new-code way to add on-chain volume.

---

## 3. Ideas for driving more transactions

Ranked by leverage × legitimacy. The guiding rule: **volume must come from real gameplay and
real value movement.** Artificial/wash transactions risk the grant looking like spam and are not
worth the reputational cost — every idea below ties a transaction to something a player actually
did or earned.

### Ship-now (built or specced, just needs enabling)
- **Endless pool is funded** — set `ENDLESS_REWARD_POOL_CONTRACT` on the host to turn the single
  biggest multiplier (1 tx/wave) fully live. No code.
- **Enable rank UBI pools** so ranking up unlocks a real daily-claim tx per rank tier.
- **On-chain daily check-in reward.** Today `/daily-claim` is DB-only. Pay a small G$ streak
  reward from the pool (`distributeReward` with a `daily:{wallet}:{yyyymmdd}` ref) → **1 tx per
  DAU per day**, steady baseline volume that scales directly with retention.
- **PvP stakes (B4, specced not built).** Staked score-duel: escrow deposit + winner payout =
  **2+ txs per duel**. High volume if PvP takes off, and it moves real G$.
- **Patrol / idle passive income (specced).** A rank-scaled G$ trickle claimed on a cooldown →
  1 tx per claim, and a DAU hook. Doubles as the fix for the dead rank-drip.

### New sinks/faucets (each action = a transaction, each moves G$)
- **Achievements / milestones on-chain.** Wire the existing achievements system so each unlock
  records on-chain (or mints a badge NFT). 1 tx per milestone; naturally paced by play.
- **Consumables as ERC-1155 burns.** Boosters / field-kits consumed per run → a burn tx per use.
- **Weapon upgrades / crafting.** Spend G$ + burn materials to upgrade a gun → 1 tx per upgrade;
  a repeatable sink that also deepens progression.
- **Cosmetic re-rolls / skin unlocks.** Pay G$ to roll or claim a cosmetic → 1 tx per roll.
- **Prestige mint.** Minting a prestige token when a player climbs past Diamond → 1 tx per prestige.
- **Season buy-in.** Small G$ entry to join a ranked season → 1 escrow tx per player per season,
  plus the existing payout at close.
- **Tipping / gifting.** Social P2P transfers already exist (#10); surfacing a "tip" affordance
  turns them into a recurring `transferFrom` stream.

### For a GoodDollar/Celo grant specifically
Favor ideas that **cycle G$ through the pools** (velocity), not just count writes: Endless
per-wave, daily on-chain reward, marketplace + re-arm sinks (G$ flows back into the RewardPool,
refilling the prize pool), P2P tipping, and PvP stakes. These raise transaction count **and**
G$ moved at the same time — aligned with the ~1.5M G$/3-month volume target.
