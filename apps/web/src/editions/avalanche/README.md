# Avalanche edition

**Status: scaffold only. Nothing is built.**

Everything Avalanche-specific lives in this folder. Same rule as the MiniPay
edition: this folder may import from `engine/`, `components/`, `hooks/`,
`lib/`, and nothing outside `editions/` imports from here.

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

## Before anything ships here

- [ ] **Sybil answer.** Dropping GoodDollar drops the only thing preventing
      one person from farming rewards across fifty wallets. Required before
      `earning` or any pool-funded payout is enabled.
- [ ] **Deploy the contracts** and record the addresses. `currency.address` is
      `null` on purpose; never guess it.
- [ ] **Un-hardcode the chain.** `celo` is imported directly in roughly fifteen
      files, and `chainId: 42220` is written literally inside
      `hooks/useMarketplace.ts` and `hooks/useResale.ts`. Mechanical work, but
      it must be finished before this edition can function at all. Doing the
      MiniPay edition first does NOT cover this, since MiniPay is also Celo.
- [ ] **Economy separation.** Decide explicitly whether progress, ranks and
      inventory are shared with the Celo editions or start fresh. Shared state
      across two economies is where the hardest bugs will come from.

## Order

MiniPay first. It is the same chain, it needs the same surgery (no GoodDollar,
no earning, edition-aware server), and MiniPay asked for it, which makes it a
warm invitation rather than an application. Do that work once, with real users
testing it, and this edition becomes mostly a chain swap.
