# GoodBuilders Season 4 — milestone evidence

How to evidence a Valor deliverable on flowstate.network, and the actual links
and numbers for the four milestones currently open.

Written 2026-07-27. Numbers verified against the production database and Celo
mainnet on that date. **Re-run the queries at the bottom before submitting** —
several are close to a threshold and will have moved.

---

## 1. The evidence pattern

A reviewer is asking one question: *did the thing you claim exist actually get
built, and can I check without taking your word for it?* Four links answer that,
in descending order of how convincing they are:

| # | Evidence | Why it convinces | Where it goes |
|---|----------|------------------|---------------|
| 1 | **On-chain proof** (Celoscan) | Cannot be faked or backdated. A contract deployment or a transaction is a fact. | `Analytics` slot, or a 4th link |
| 2 | **Merged PR** (GitHub) | Dated, reviewable diff. Shows the work AND when it landed. | `Github` slot |
| 3 | **Live feature** (playvalor.app) | Reviewer can use it themselves. | `Valor` slot |
| 4 | **Dashboard** (Dune) | Shows it is *used*, not just shipped. | `Analytics` slot |

Prefer a **merged PR** over a bare commit: it carries a title, a description, a
date and a diff in one URL. Fall back to a commit only where the work predates
the PR workflow.

### Base URLs

```
Repo         https://github.com/MarvyNwaokobia/Valor
PR           https://github.com/MarvyNwaokobia/Valor/pull/<n>
Commit       https://github.com/MarvyNwaokobia/Valor/commit/<sha>
File+lines   https://github.com/MarvyNwaokobia/Valor/blob/main/<path>#L10-L40
App          https://playvalor.app
Dashboard    https://dune.com/marvyy/valor
```

### Contracts (Celo mainnet, all UUPS proxies)

| Contract | Address | Celoscan |
|---|---|---|
| ValorGameRecord | `0xd4ec6dB553E206cdf741448F94bD3B02D81c8571` | https://celoscan.io/address/0xd4ec6dB553E206cdf741448F94bD3B02D81c8571 |
| ValorMarketplace | `0x95D167f569cf05C967C0432e3123baeac5D8d78D` | https://celoscan.io/address/0x95D167f569cf05C967C0432e3123baeac5D8d78D |
| ValorItems (ERC-1155) | `0x3ba09c51895Dacb90273A2A40C95369a5A1b4bFe` | https://celoscan.io/address/0x3ba09c51895Dacb90273A2A40C95369a5A1b4bFe |
| ValorRewardPool | `0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4` | https://celoscan.io/address/0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4 |
| Endless Reward Pool | `0xd44D31645e3abBDc48a6Fc5E6E1bCd894db77Ba0` | https://celoscan.io/address/0xd44D31645e3abBDc48a6Fc5E6E1bCd894db77Ba0 |
| **Backend relay** (sends 99.94% of all txs) | `0x43a5ba0da132b21bDACfBC4392B72eEbAF6F2D82` | https://celoscan.io/address/0x43a5ba0da132b21bDACfBC4392B72eEbAF6F2D82 |

The relay wallet is the single best "all activity" link: 1,731 of 1,732
transactions to Valor contracts since June originate there, because the backend
pays gas for every battle record, reward and purchase. Add `#tokentxns` to see
G$ movement specifically.

### Writing the update text

Three sentences, in this order. Keep it factual; the links carry the weight.

1. **What shipped** — the capability, in a reviewer's language, not ours.
2. **How it works** — the one technical fact that proves it is real (which
   contract, which mechanism).
3. **Evidence** — the links, labelled.

> Players can list any owned ERC-1155 item for sale at their own price and buy
> from other players, settled on-chain. Listings are approval-based against the
> upgraded ValorMarketplace, so the seller keeps custody until the sale
> executes. Evidence: [PR](…) · [live](…) · [contract](…)

Avoid "we implemented", "we built", "successfully". State the capability.

---

## 2. Build Milestone 1 — Open Player-to-Player Marketplace

### D1 — Player listing flow

Players list earned items directly from inventory.

- **Github** — `e5f1026` on-chain player-to-player resale (approval-based)
  https://github.com/MarvyNwaokobia/Valor/commit/e5f1026
- **Valor** — https://playvalor.app/marketplace (Inventory panel → **List**)
- **Analytics** — ValorItems `ApprovalForAll` + `TransferSingle` events:
  https://celoscan.io/address/0x3ba09c51895Dacb90273A2A40C95369a5A1b4bFe#events

Supporting code, if a reviewer wants the diff narrowed:
`apps/web/src/components/player-card/InventoryPanel.tsx` (the List control),
`apps/web/src/hooks/useResale.ts` (`listForResale`).

### D2 — P2P purchasing, settlement, ownership transfer, inventory sync

- **Github** — `e5f1026` (settlement) + `89c20c4` (resale browse UI)
- **Valor** — https://playvalor.app/marketplace → **Resale** tab
- **Analytics** — https://celoscan.io/address/0x95D167f569cf05C967C0432e3123baeac5D8d78D

Ownership transfer is literally the ERC-1155 `TransferSingle` on ValorItems —
point at that event, it is the strongest single artefact in this milestone.

Also relevant: `45f1d05` (field kit on-chain), `02cbef4` (every catalogue item
carries an `on_chain_id`), `977f82f` (items 26–28 registered on-chain).

### D3 — Discovery: filtering, sorting, rarity, pricing, seller profiles

- **Github** — `1dee7aa` premium tactical presentation · `710a1cf` PBR + HDRI
  catalogue art · `b33c027` ranked armoury, Ember Halo closes with the season
- **Valor** — https://playvalor.app/marketplace
- **Analytics** — Economy section of https://dune.com/marvyy/valor

Seller identity is in `ResaleBrowse.tsx` (each listing shows the seller address,
"Your listing" when it is yours).

### D4 — Creator/admin tooling: moderation, featured collections, analytics

- **Github** — `c79378a` season delete/reschedule/wipe controls · `815e4c5`
  schedule a season with window, pool and payout split · [PR #30](https://github.com/MarvyNwaokobia/Valor/pull/30)
  stop counting UBI as Valor's money (analytics correctness)
- **Valor** — https://playvalor.app/admin
- **Analytics** — https://dune.com/marvyy/valor

Revenue tooling is real and worth naming: `a5404f2` recirculates marketplace
revenue into the reward pool, `df22d72` is the outstanding-balance settlement
flow.

### Success metrics — verified 2026-07-27

| Metric | Target | Actual | |
|---|---|---|---|
| Marketplace deployed to production | yes | yes | ✅ |
| Successful trades | 20+ | **30** purchases, 17 distinct buyers | ✅ |
| Marketplace volume | 100,000 G$ | **23,460 G$** | ⚠️ 23% |

Volume is the gap. Report it plainly with the trade count next to it — 30 trades
against a 20 target is a genuine beat, and burying it to hide the volume number
costs more credibility than the miss does.

---

## 3. Build Milestone 2 — Seasonal Ranked Leagues

### D1 — Ranked matchmaking and player rating

- **Github** — `4098cf1` async PvP as a standalone Ranked mode ·
  [PR #6](https://github.com/MarvyNwaokobia/Valor/pull/6) 7-tier ladder with
  uncapped prestige · [PR #7](https://github.com/MarvyNwaokobia/Valor/pull/7)
- **Valor** — https://playvalor.app/fight
- **Analytics** — Users section of https://dune.com/marvyy/valor

Rating system = the Iron→Diamond ladder with progressive XP thresholds
(400/900/1300/2500/4500/8000) and prestige beyond Diamond. Matchmaking lives in
`apps/api/src/services/game_server.rs`.

### D2 — Real-time PvP over WebSocket

- **Github** — [PR #1](https://github.com/MarvyNwaokobia/Valor/pull/1) real-time
  combat engine · `c0be696` GameRoom MatchEnd wired to server-authoritative
  rewards
- **Valor** — https://playvalor.app/fight → Duels
- **Analytics** — https://celoscan.io/address/0xd4ec6dB553E206cdf741448F94bD3B02D81c8571

Infrastructure: `apps/api/src/handlers/ws.rs`,
`apps/web/src/hooks/useGameSocket.ts`,
`apps/web/src/engine/multiplayer/PvPManager.ts`.

⚠️ **The database records 1 duel, ever.** The infrastructure shipped; nobody has
used it. Claim the build, do not imply usage, and do not cite a usage metric
here.

### D3 — Seasonal leaderboard with live ranking

- **Github** — [PR #26](https://github.com/MarvyNwaokobia/Valor/pull/26) stop
  dropping waves on restart, show the whole board · [PR #28](https://github.com/MarvyNwaokobia/Valor/pull/28)
  top 10 at 50,000 G$ · `fbdf0d8` enforce the season window server-side
- **Valor** — https://playvalor.app/seasonal
- **Analytics** — Season section of https://dune.com/marvyy/valor
  ([activity](https://dune.com/queries/8128988) ·
  [per-fighter](https://dune.com/queries/8128992))

This is the best-evidenced deliverable in the whole submission: a season that
actually ran, with independently verifiable on-chain activity behind it.

### D4 — Automated season registration, reward calculation, G$ payouts (50%)

- **Github** — `815e4c5` schedule a season with window, pool and payout split ·
  `c79378a` admin controls · [PR #9](https://github.com/MarvyNwaokobia/Valor/pull/9)
  Endless pays from a separate reward pool
- **Valor** — https://playvalor.app/admin
- **Analytics** — https://celoscan.io/address/0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4

**50% is the honest number and should stay 50%.** Registration and reward
calculation are automated; the payout leg is not — `season_payouts` is empty and
the Season 1 prize has not gone out. When the 10 × 50,000 G$ transfers run, the
Celoscan link above becomes the proof and this moves to 100%.

### Success metrics — verified 2026-07-27

| Metric | Target | Actual | |
|---|---|---|---|
| First competitive season completed | yes | Season 1 ran 27 Jul | ✅ |
| Active competitors | 50 | **33** | ⚠️ 66% |
| Prize pool distributed automatically | yes | **0 payouts recorded** | ❌ |

---

## 4. Growth Milestone 1 — Community Onboarding & Early Players

### A1 — Launch across GoodDollar community channels (100%)

Evidence is external: link the actual announcement posts. A screenshot is weak;
a permalink to the post in the GoodDollar Discord/Telegram is strong.

### A2 — Daily "Claim G$ & Play" onboarding campaign (100%)

- **Community Channel** — the campaign post
- Supporting: `754dcfb` single-signature daily claim with gas auto-provisioning
  (CELO/G$/faucet). The claim flow is the campaign's mechanism, and it is a
  legitimately hard piece of engineering — worth naming.

### A3 — Community events introducing competitive gameplay (0%)

Not started. Season 1 arguably counts as one — if you host a second, this and
A4 are the cheapest percentage points on the board.

### A4 — Onboarding events introducing marketplace trading (0%)

Not started.

### Success metrics — verified 2026-07-27

| Metric | Target | Actual | |
|---|---|---|---|
| New registered players | 300 | **100** | ⚠️ 33% |
| G$ distributed through gameplay | 500,000 | **203,010 G$** | ⚠️ 41% |

---

## 5. Growth Milestone 2 — Seasonal Reward System Launch

### A1 — Season One marketing campaign (100%)

Link the announcement posts.

### A2 — Competitive leaderboard launch (100%)

- https://playvalor.app/seasonal
- Season section of https://dune.com/marvyy/valor

### A3 — Season-long competitive community tournaments (100%)

Season 1 "First Breach", 27 Jul 2026 (WAT). 33 fighters, 835 battles, 116 wave
clears. On-chain: https://dune.com/queries/8128988

### A4 — Season-end reward distribution (100%) ⚠️ **THIS IS WRONG**

`season_payouts` is **empty**. The Season 1 prize — 10 × 50,000 G$ — has not
been sent. This is marked complete and it is not.

Either run the payout before submitting, or set this to 0–50%. Leaving it at
100% is the single highest-risk item in the submission: a reviewer who clicks
the reward pool on Celoscan sees no outbound transfers, and that one discovery
puts every other 100% on this page in question.

Once the payout runs, it becomes the best evidence you have — ten transfers,
same day, same amount, publicly verifiable:
https://celoscan.io/address/0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4

### Success metrics — verified 2026-07-27

| Metric | Target | Actual | |
|---|---|---|---|
| Seasonal participants | 500 | **33** | ⚠️ 7% |
| Ranked matches | 1,000 | **1,172** battles total (835 in-season) | ✅ / ⚠️ |
| G$ prizes distributed | 300,000 | **0** (500,000 committed, unsent) | ❌ |

On ranked matches: 1,172 total battles clears the bar, but they are PvE, not
"ranked matches" as a reviewer would read it. Say **"1,172 recorded battles,
835 during Season 1"** and let the on-chain record speak. Do not restate PvE
volume as ranked volume.

---

## 6. Fix before submitting

1. **Growth M2 / A4 → run the payout or drop the percentage.** Highest risk item.
2. **Build M2 / D4 stays at 50%** until the same payout runs. Both resolve together.
3. **Three merged-but-undeployed PRs** — confirm production is current:
   [#30](https://github.com/MarvyNwaokobia/Valor/pull/30),
   [#31](https://github.com/MarvyNwaokobia/Valor/pull/31),
   [#32](https://github.com/MarvyNwaokobia/Valor/pull/32).
4. **Fix the typo** — Build M2 / D1 analytics chip reads "Ananlytics".
5. **Build M2 / D3 is missing its Github chip** — the other 15 deliverables have
   three links; that one has two.

## 7. Re-run before submitting

```bash
DBURL=$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"')

# Headline counts
psql "$DBURL" -c "
select 'players' k, count(*)::text v from players
union all select 'trades', count(*)::text from inventory
union all select 'distinct_buyers', count(distinct wallet_address)::text from inventory
union all select 'season_participants', count(distinct wallet_address)::text from endless_progress
union all select 'battles', count(*)::text from battles
union all select 'duels', count(*)::text from duels
union all select 'season_payouts', count(*)::text from season_payouts;"

# G$ by category — 'battle_reward' is the gameplay-distributed figure
psql "$DBURL" -c "select category, count(*) n, sum(amount) total_g from g_ledger group by 1 order by 3 desc;"
```

### Reconciliation note

Two internal sources appear to disagree on gameplay G$ and a reviewer may spot
it. They do reconcile:

```
op_play_bounties    paid     7,000     (23 rows / 172,500 G$ are VOIDED, never sent)
first_clear         paid   166,510     (2 rows / 1,500 G$ failed)
rank_up             paid     7,500
endless             paid     1,000
                          ─────────
                           182,010
replay backpay              21,000     (19,000 + 2,000, settled separately)
                          ─────────
g_ledger battle_reward     203,010     ✓
```

**Quote 203,010 G$.** Summing the bounty tables raw gives 356,010 and counts
172,500 G$ of voided rows that were never paid — an inflated number that
collapses under one query.
