# Avalanche edition

**Status: live on C-Chain since 2 Aug 2026.** Scrip, the item registry, the
marketplace and the match-record contract are deployed and verified. Staked duels
are written and tested; the escrow contract is not deployed yet (see below).

Everything Avalanche-specific lives in this folder. Same rule as the MiniPay
edition: this folder may import from `engine/`, `components/`, `hooks/`,
`lib/`, and nothing outside `editions/` imports from here.

## What is actually on chain

| Contract | Address |
|---|---|
| Scrip (SCRP) | `0x9e3cFd517111D6d458e0Aa51deCAC66413388537` |
| ValorItems | `0x9a7890532b7581c7fea587f01ca6b876cd017677` |
| ValorMarketplace | `0x751fBFFFc9419BC825645cD69661e51Ae2D529f6` |
| ValorGameRecord | `0xb6394d320e941674292a5c8db48f069f46bc77a6` |
| ValorDuel | **not deployed** — see `script/DeployValorDuel.s.sol` |

All proxies and implementations are verified on Snowtrace.

## This is not a separate deployment

Worth being explicit, because the code reads as though it might be. There is no
Avalanche build of the site: `NEXT_PUBLIC_EDITION=avalanche` exists and works,
but production runs the `web` edition, and Avalanche reaches players *through*
it — the Bank claims SCRP, the shop's currency toggle spends it, the duel lobby
stakes it. That is deliberate. Players do not get sent to a second URL to use a
second currency, and every player is one row in `players` whichever chain they
transact on.

The consequence is that `players.edition` is `web` for everyone, including
people who have only ever spent SCRP. Do not read that column as "which chain
this player uses"; it records which door they came through.

## Why this edition exists

A grant, and an audience. Avalanche has an unusually active gaming community,
and Valor is a real shipped game with real players, which is a much stronger
application than a proposal for something that does not exist yet.

## The pitch, and why the domain stays the same

Valor stays on **playvalor.app** for every edition. Grant committees measure
ecosystem contribution from **on-chain activity** — contract addresses and
transaction volume — not from which domain served the page. So one domain
costs nothing with them and gains a great deal with players, who never get
told to go somewhere else to play the game they already play.

The strong version of the pitch is: *"a live game with 120+ existing players,
plus a competitive mode built for your ecosystem, bringing both onto
Avalanche."* Not: *"a new game with no users on a new domain."*

## What this edition should be

Not the G$ earn loop with different-coloured money. That loop cannot exist
here — GoodDollar is Celo and Fuse only.

Lean competitive instead: **staked duels, tournaments, seasons, prizes.**
Already specced, never built. That is the Avalanche differentiator, and see
the sybil note in `config.ts` for why stake-based play is also the safer
design when there is no proof-of-unique-human available.

## Done

- [x] **Sybil answer.** SCRP has no exit, so there is nothing to farm. This is
      load-bearing, not a limitation — see the header of `config.ts` and
      `services/chain_id.rs`, which holds the same rule server-side where it
      actually binds. Staked duels strengthen it further: value moves between
      players rather than out of a pool, so a hundred farmed wallets can only
      take SCRP off each other.
- [x] **Contracts deployed** and their addresses recorded above.
- [x] **Chain un-hardcoded.** `chainSpendConfig` / `chainDuelConfig` in
      `editions/chain.ts` resolve currency, contract and permit domain per chain.
- [x] **Economy separation.** Shared: one `players` row, one rank, one campaign
      progress, because an EVM address is the same address on both chains.
      Separate: balances, prices, item registries and duel escrow. `g_ledger`
      and `earnings` both carry `chain_id`, and `ChainId` is a required argument
      rather than a defaulted one so a payout cannot be misfiled.

## Left to do

- [ ] **Deploy ValorDuel** (`script/DeployValorDuel.s.sol`). Needs a Safe address
      for the owner — the script refuses to let the relay own it.
- [ ] **Move ownership off the relay** (`script/HandOverToSafe.s.sol`). Today one
      hot key owns Scrip, both proxies and the record contract, and can mint.
- [ ] **Burn the deployer's test SCRP.** 1,125 of 1,225 supply sits in
      `0x9283f1…` from deploy-time testing.

## Why staked duels are the point of this edition

Not the G$ earn loop with different-coloured money. That loop cannot exist here:
GoodDollar is Celo and Fuse only. What Avalanche has is a gaming audience that
turns up for stakes and ownership, so the mode built for it is the one where
players put something at risk against each other.

It is also the safer economic design. A reward pool paying players is a target;
an escrow moving value *between* players is not. The house takes 0.5% and that
cut is the only new money the system needs, which is what eventually funds the
SCRP exit without minting a single token to pay for it.
