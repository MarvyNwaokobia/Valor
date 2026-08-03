# Valor

**A first-person tactical shooter with a player-owned economy, live on Celo and
Avalanche C-Chain.**

Version 1.0 · 3 August 2026 · [playvalor.app](https://playvalor.app)

---

## 1. Summary

Valor is a browser-based tactical FPS that people already play. It has 128
registered players, 2,534 recorded battles, 2,274 match records written to chain,
and 89 item purchases across 43 distinct buyers. It is not a proposal for a game.

It runs on two chains, for two different reasons.

**Celo** is the money rail. Rewards pay in G$ (GoodDollar), which is a real
currency with an exchange rate, and GoodDollar's proof-of-unique-human is what
makes paying players for playing possible without one person farming it from
fifty wallets. Valor is a GoodBuilders Season 4 grantee on that basis.

**Avalanche C-Chain** is the competitive rail. GoodDollar does not exist here, so
the redistributive loop cannot be copied over, and copying it would be the wrong
thing to build anyway. What Avalanche has is a gaming audience that turns up for
stakes and ownership. So the mode built for it is the one where players put
something at risk against each other: **staked duels**, escrowed by a contract,
settled on-chain, denominated in Scrip.

This document describes what exists, what is deployed, what is not, and the
design decisions behind the parts that could reasonably be questioned.

---

## 2. The game

A solo-and-competitive first-person shooter running on Three.js in the browser.
No install, no launcher, no wallet required to start playing.

- **Campaign.** 15 operations with a narrative spine. Kill-driven XP: 10 per
  kill, 15 for a headshot, 50 for a clear, 100 for a boss.
- **Endless.** Room-wave survival with its own leaderboard and per-wave rewards.
- **Seasonal.** Fresh-start competitive seasons on a schedule. Season 1 ran on
  27 July 2026 with 33 fighters and 835 battles.
- **Duels.** Two players run the *same* server-issued seed separately; the higher
  server-validated score takes the pot. This is the staked mode, described in
  detail in section 5.

Progression is a 7-tier ladder (Iron through Diamond) with uncapped prestige
beyond it, on a progressive XP curve. One full campaign clear is 2,610 XP.

**Why async rather than live PvP.** There is no shared real-time simulation, so
there is nothing to desync and nobody waits for an opponent to be online. The
only thing a client reports is a score, and the server range-checks that against
elapsed time it measured itself from a token it issued. Live netcode for a
browser FPS is a large, fragile problem that buys a worse product for this
particular game.

---

## 3. Traction

Verified against the production database and both chains on 3 August 2026.

| Metric | Value |
|---|---|
| Registered players | 128 |
| New players, last 7 days | 37 |
| Battles recorded | 2,534 |
| Match records on Celo | 2,274 |
| Item purchases | 89, across 43 distinct buyers |
| Endless participants | 42 |
| G$ paid to players in rewards | 644,446 |
| G$ moved through the marketplace | 73,900 |
| G$ withdrawn by players to their own wallets | 711,146 |

Every one of these is independently checkable. The contracts are listed in
section 8 and the backend relay wallet is the single best "all activity" link,
because it pays gas for every match record, reward and purchase.

**What Avalanche activity is, honestly.** Contracts went live on C-Chain on
2 August 2026. Since then there are 109 transactions touching Valor contracts:
26 item listings, 14 mirrored match records, 1 Scrip claim, and zero SCRP
purchases by players. The mirrored match records are duplicates of matches also
recorded on Celo, and they should not be counted as native Avalanche adoption.
This deployment is one day old. Presenting it as more than that would be easy
and would not survive anyone clicking the explorer.

---

## 4. Scrip (SCRP)

The in-game currency on Avalanche. An ERC-20 with a 1,000,000,000 hard cap,
minted on demand as players earn it, deployed as a UUPS proxy owned by the Safe.

One caveat stated up front, because a reviewer will find it: the token live on
chain today was deployed on 2 August 2026 as a plain non-upgradeable contract,
before that rule was settled. Bytecode cannot be moved behind a proxy after the
fact, so making it upgradeable means redeploying at a new address and moving
holders across. That migration is written and not yet run. Supply is 1,225 SCRP
with exactly one real holder, so it is a one-address migration today and gets
harder every week it waits.

Military scrip is currency a force issues to its own people, spendable at its own
store and not legal tender anywhere else. That is exactly what this is, and the
name is deliberate.

### It is not redeemable, and that is the point

SCRP cannot be sold. There is no swap, no pair, no exit.

This is not an oversight or a "coming soon". GoodDollar lives on Celo and Fuse,
so Avalanche has no proof-of-unique-human available to Valor. If SCRP could be
sold, one person farming fifty wallets would be worth doing on day one. Because
it cannot be, it is not. Fifty farmed wallets earning fifty piles of something
with no exit is not an attack worth mounting.

The rule is enforced in three places that would each have to be changed
deliberately: `Scrip.sol` implements no redemption path, `chain_id.rs` returns
`is_redeemable() == false` for Avalanche with a test that fails if anyone flips
it, and the edition config hides the Bank's withdraw and transfer-out entirely.

An exit will exist eventually. When it does it must be **funded from real revenue**
(marketplace cuts, duel house cuts) rather than from minted supply, and it must
sit behind an identity gate. Those are two hard preconditions, not a roadmap item
to be quietly dropped.

### How it is earned and issued

Players accrue SCRP as a database credit while playing (100 per campaign clear,
plus per-wave amounts in Endless), then **claim** it at the Bank, which mints it
on-chain in one transaction. Accrue-then-claim rather than pay-per-win is what
keeps the relay from draining: one transaction per claim instead of one per
victory.

---

## 5. Staked duels

The mode Avalanche exists for in this project.

### The loop

1. A challenger picks a stake from a fixed ladder (10 / 25 / 50 / 100 / 250 / 500
   SCRP) and signs an EIP-2612 permit for exactly that amount.
2. The backend relays it. `ValorDuel` consumes the permit and pulls the stake
   into **its own escrow**. The player spends no AVAX.
3. Another player accepts. Their stake is read from the duel already stored, so
   both sides are always in for the identical amount.
4. Both play the same server-issued seed, separately, one life each.
5. The server validates both scores and tells the contract who won. The winner
   takes the pot minus a 0.5% house cut. A draw refunds both in full and takes
   nothing, because charging a fee on a duel nobody won would be the house
   billing for a non-result.

The stake ladder is sized against what a player can actually earn. One campaign
op pays 100 SCRP, so the entry tier is affordable after a single op and the top
tier is reachable inside one campaign. There is a test asserting exactly that,
because a mode nobody can afford to enter is not a mode.

### Why the escrow is a contract and not a pool

On Celo, duel stakes move into the ValorRewardPool and the backend pays the
winner out of it. That works, and it reuses proven rails, but it means player
money sits somewhere the operator controls.

On Avalanche the stake is held by `ValorDuel` itself, which gives three
properties the pool rail does not have:

**1. The resolver can pick the winner but never the recipient.** `resolve` checks
the address it is paying against the duel's own two participants and reverts on
anything else. A fully compromised backend key can rig a match, which is bad, and
cannot move a single SCRP to an address outside the duel, which would be fatal.

**2. Player funds are not reachable by the operator.** The owner can rotate the
resolver, tune the fee within a hard 10% cap, and withdraw accrued house cut.
Revenue is tracked as a separate number rather than inferred from the balance,
so a withdrawal cannot reach escrowed stakes even though both sit at the same
address. There is a test that runs a withdrawal with a live duel open and asserts
the escrow is untouched.

**3. Nobody's stake depends on Valor continuing to exist.** `reclaim` is
permissionless: after 24 hours on an unresolved duel, or 7 days on an unaccepted
one, *anyone* can call it and both sides are refunded in full, with no cut taken.
If this project were abandoned tomorrow, every SCRP held by the contract would
still be recoverable by the people who staked it. There is a test that abandons
three duels in three different states, throws the resolver key away, and asserts
the contract drains to zero.

### Upgradeability, and what it costs

`ValorDuel` is a UUPS proxy, like every other Valor contract, owned by the Safe.

The honest reading of that: the three properties above are guarantees of the
current code, not of the address. Whoever holds the upgrade key can replace this
logic with logic that moves escrowed stakes anywhere. What protects them is that
`_authorizeUpgrade` is `onlyOwner`, the owner is a multisig, and changing them
therefore takes several people signing something publicly visible on chain rather
than one compromised server key.

`reclaim` remains the strongest single line of defence, because it needs no key
at all. A timelock on the upgrade path is the obvious next hardening step and is
not done yet.

This was originally written immutable, on the argument that a contract promising
"we cannot touch your stake" should not also be able to rewrite its own rules.
That argument is real, and the trade was made deliberately in favour of being
able to fix a bug in an escrow holding player money rather than only watch it.

### Why staking is the right economic design here

A reward pool paying players is a target: the incentive is to manufacture
players. An escrow moving value between players is not: the incentive is to be
better at the game. The house takes 0.5%, and that cut is the only new money the
system needs. It is also what eventually funds the SCRP exit without minting a
single token to pay for it.

This is the same reason staking doubles as a sybil answer. A hundred farmed
wallets can only take SCRP off each other.

---

## 6. Item ownership

Every item in Valor is an on-chain ERC-1155 on both chains: guns, ammo,
attachments, boosters, field kits. 26 items are registered and listed on
Avalanche.

Players can list any item they own for resale at their own price and buy from
each other. Listings are approval-based, so the seller keeps custody until the
sale executes. The platform takes a 5% fee on resale, which is the second sink.

The invariant that matters operationally: the database price and the on-chain
listing price must be identical, or a purchase builds a permit signature that
disagrees with the listing and reverts after the player has already signed. Items
carry per-chain prices for exactly this reason. The same rifle is 1,200 G$ and
6,000 SCRP, and quoting one for the other is a revert, not a rounding error.

---

## 7. Security posture

Stated plainly, including what is currently wrong.

**Good today.** All contracts and implementations are verified on Snowtrace and
Celoscan. The duel escrow separates the owner role from the resolver role, so
neither key alone can take player funds. Rewards route through a single
`award_player` path. Payouts are idempotent by on-chain reference. Chain
attribution is a required argument rather than a defaulted one, so a payout
cannot be silently misfiled to the wrong chain.

**Wrong today, being fixed.** One hot relay key currently owns Scrip, ValorItems,
ValorMarketplace and ValorGameRecord on Avalanche, which makes it simultaneously
the minter, the minter-appointer and the UUPS upgrade authority, while also
signing automated transactions from a live server. A Safe multisig is being
created and `script/HandOverToSafe.s.sol` moves every ownership to it, leaving
the relay with only what it needs to run the game: minting rewards, writing match
records, and settling duels. After that handover the Safe can revoke the relay's
minter status in one transaction without the relay's cooperation, which it cannot
do today.

Also outstanding: 1,125 of the 1,225 SCRP in existence sit in the deploy wallet
from deployment testing and will be burned.

---

## 8. Contracts

**Avalanche C-Chain (43114)**

| Contract | Address |
|---|---|
| Scrip (SCRP) | `0x9e3cFd517111D6d458e0Aa51deCAC66413388537` |
| ValorItems | `0x9a7890532b7581c7fea587f01ca6b876cd017677` |
| ValorMarketplace | `0x751fBFFFc9419BC825645cD69661e51Ae2D529f6` |
| ValorGameRecord | `0xb6394d320e941674292a5c8db48f069f46bc77a6` |
| ValorDuel | pending deploy |

**Celo (42220)**

| Contract | Address |
|---|---|
| ValorGameRecord | `0xd4ec6dB553E206cdf741448F94bD3B02D81c8571` |
| ValorMarketplace | `0x95D167f569cf05C967C0432e3123baeac5D8d78D` |
| ValorItems | `0x3ba09c51895Dacb90273A2A40C95369a5A1b4bFe` |
| ValorRewardPool | `0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4` |
| Endless Reward Pool | `0xd44D31645e3abBDc48a6Fc5E6E1bCd894db77Ba0` |

Source: [github.com/MarvyNwaokobia/Valor](https://github.com/MarvyNwaokobia/Valor)
· Analytics: [dune.com/marvyy/valor](https://dune.com/marvyy/valor)

---

## 9. What comes next

**Immediate.** Deploy `ValorDuel` behind a Safe, move all ownership off the relay
key, burn the deployer's test SCRP, and run the first real staked duels.

**Near term.** Tournaments with SCRP prize pools funded from the house cut rather
than from minting. Seasonal competition on Avalanche alongside Celo. Getting SCRP
into enough hands that the item economy has real velocity rather than 26 listings
and no buyers.

**Conditional, and gated on two hard preconditions.** A SCRP exit, funded from
accumulated revenue and sitting behind proof-of-unique-human. Neither the funding
nor the identity gate exists yet, and the token stays non-redeemable until both
do.

**Not planned.** Selling SCRP. Pre-mining a treasury allocation. Any mechanism
where the studio's return comes from token issuance rather than from a cut of
activity players chose to generate.

---

## 10. What Avalanche funding would change

Concretely, in order of impact:

1. **Ship the staked-duel loop to real players.** Contract, backend and UI are
   written and tested. What remains is deployment, a Safe, relay gas, and the
   work of getting a playerbase to actually duel.
2. **Fund tournament prize pools** so competitive seasons on Avalanche have
   stakes worth turning up for, without funding them by minting.
3. **Relay operations.** Every match record, claim and duel settlement costs
   AVAX. The single most common cause of failed payouts in this project's history
   is a relay running dry, on a different chain, with a different token. It is a
   solved problem when it is funded and monitored, and it is not free.
4. **Native Avalanche acquisition.** Valor's 128 players arrived through Celo and
   GoodDollar channels. Reaching the Avalanche gaming audience is a different
   motion and the honest gap in this application.
