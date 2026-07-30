# Valor Editions Roadmap — MiniPay and Avalanche

One codebase, three doors. The app resolves which edition it is at startup and
behaves accordingly. See `apps/web/src/editions/` for the layer and
`apps/api/src/services/edition.rs` for the server half.

**Status at last update: 2026-07-30.** MiniPay boots, onboards and plays on a real
device. Two things block it being shippable: orientation and load time.

---

## Where things actually stand

### Done and verified on hardware

- [x] Editions layer: detection, per-edition config, the no-forking import rule
- [x] MiniPay auto-connect with no sign-in screen (`MiniPayProvider`)
- [x] GoodDollar identity gate skipped where there is no identity provider
- [x] "Add to Home Screen" prompt suppressed inside the WebView
- [x] Phantom MetaMask row filtered out of the wallet list
- [x] Server-side earning lock: `players.edition`, immutable after signup, read by
      every payout path including referrals
- [x] Confirmed on an iPhone in MiniPay: opens, onboards, creates a character,
      reaches the loadout, and eventually loads into an op

### Known broken in MiniPay

- [ ] **Landscape gate never clears.** `ValorScene` measures the viewport
      (`h > w`), and MiniPay's container does not rotate with the phone. Blocks
      play outright. See Phase 1.
- [ ] **Load takes minutes.** Same phone in Safari is fast, but Safari has a warm
      cache, so the comparison is not clean. See Phase 2.
- [ ] **Buying anything fails.** The marketplace contract cannot be used from
      MiniPay at all. See Phase 3.
- [ ] Duels switched off in config (they sign typed data).

---

## Open questions for MiniPay — ask before building

These two answers change the shape of Phases 1 and 2. One message covers both.

1. **Does a Mini App support landscape?** Valor's FPS is landscape-only and gates
   play on it. MiniPay's listing requirement is "fully functional at 360×640",
   which reads as portrait-only. If landscape is possible, Phase 1 disappears.
2. **What is the real size and speed bar for a 3D game?** The published
   requirements are a 2MB footprint and 90+ PageSpeed. Valor cannot hit those as
   written. Their answer decides how far Phase 2 has to go.

MiniPay approached us, so both are fair to ask.

---

## Phase 1 — Orientation (blocks everything)

No point optimising a game that cannot be played. Route depends on the answer to
question 1.

**If MiniPay supports landscape:**
- [ ] Enable it, delete the problem, move to Phase 2

**If it does not (assume this until told otherwise):**
- [ ] Portrait mode for the MiniPay edition: HUD relayout for a tall screen
- [ ] Touch controls repositioned for one-thumb portrait reach
- [ ] Camera FOV / aspect tuned for portrait
- [ ] Bypass the `portrait` gate for this edition only, so the prompt never shows
- [ ] Verify at 360×640, the documented minimum

---

## Phase 2 — Weight and load time

**First, one free diagnostic:** close and reopen Valor in MiniPay and enter an op
again.
- Second load fast → it is caching, and the targets below are enough
- Second load also slow → the WebView is not caching, and assets must get much
  smaller than "compressed"

### Free wins (no gameplay change)

- [ ] `git rm --cached` the ~110MB in `public/models/characters/` — tracked in git,
      deployed, and referenced by no code. The game loads `characters/glb/*.glb`
      (9.5MB for all four) instead. Same pattern `.gitignore` already uses for zips
- [ ] Same for the unreferenced parts of `public/models/environments/`
- [ ] Note: this does not speed up any player's load, since none of it was ever
      downloaded. It cuts a 361MB `.git` and Vercel build time

### Real targets, in order of weight

- [ ] **`public/characters/raw/` FBX animations, 28MB.** Biggest genuine target.
      Mixamo FBX to compressed glTF is typically a ~10x reduction
- [ ] **`public/sounds/`, 19MB.** Re-encode at mobile bitrate
- [ ] Lazy-load `scifi_stage` (6.8MB) only when a level uses it
- [ ] Load only the character models the current level needs, not all four
- [ ] Convert the multi-MB PNGs to WebP

### Then measure

- [ ] PageSpeed Insights on the production URL
- [ ] Real-device load timing in MiniPay, cold cache

---

## Phase 3 — Purchases (needs a contract)

**This is not a client change.** `ValorMarketplace.sol` is hard-wired to G$
(`IGoodDollar public gToken`), and both purchase paths are closed to MiniPay:
`purchaseWithPermit` needs a signature MiniPay cannot produce, and
`onTokenTransfer` only accepts calls from the G$ token itself. There is no
`purchase(itemId)` spending a pre-approved allowance.

Chosen approach: **a stablecoin marketplace contract for the MiniPay edition.**

- [ ] Write `ValorStableMarketplace`: `approve` + `purchase(itemId)`, USDm-denominated
- [ ] Decide the token scope. MiniPay allows USDm / USDC / USDT only.
      **Watch decimals: USDm is 18, USDC and USDT are 6**
- [ ] Price the 21 items in USD. At G$ ≈ $0.000117 the current 3,000 G$ tier is
      about $0.35, which is a sane stablecoin price point
- [ ] Deploy, verify on Celoscan, register listings
- [ ] Hold the existing invariant: **DB `price_g` must equal the on-chain price**,
      or purchases revert
- [ ] `editions/minipay/purchase.ts`: two taps, approve then buy, no signature
- [ ] Legacy transactions only. MiniPay ignores EIP-1559 — never set
      `maxFeePerGas` / `maxPriorityFeePerGas`
- [ ] Revenue withdrawal path for the new contract

---

## Phase 4 — Listing readiness

Only worth starting once Phases 1 to 3 are done.

- [ ] Copy pass: apply `copyRules` from `editions/minipay/config.ts`. MiniPay
      rejects "gas", "crypto", "onramp", "offramp" in user-facing strings
- [ ] Deposit deeplink on insufficient balance (`https://minipay.opera.com/add_cash`)
- [ ] Full manifest of every URL, subdomain and origin the app calls
- [ ] Terms of Service and Privacy Policy
- [ ] In-app support link
- [ ] Commit to the 24h SLA for critical fixes
- [ ] Sample transaction hashes for every contract method
- [ ] Submit the intake form at `https://minipay.to/mini-apps`

Reference: `apps/web/src/editions/minipay/README.md` and the celopedia skill's
`minipay-requirements.md`.

---

## Avalanche

**Deliberately after MiniPay.** Both editions need the same surgery (run without
GoodDollar identity, run without G$ earning, server-side edition trust), and
MiniPay is doing it first with real users testing it. Do Avalanche first and you
do the hard part blind.

The scaffold exists at `apps/web/src/editions/avalanche/` with `earns_real_money`
already false. See its README for the full reasoning.

### Phase A — Decide what it is

- [ ] Confirm the pitch: **competitive, not redistributive.** Avalanche's gaming
      community shows up for stakes, tournaments and ownership, not UBI. The
      already-specced staked PvP duels are the differentiator
- [ ] Decide whether progress, ranks and inventory are shared with the Celo
      editions or start fresh. Shared state across two economies is where the
      hardest bugs will come from

### Phase B — Hard blocker before any payout

- [ ] **A sybil answer.** GoodDollar is Celo and Fuse only, so this edition has no
      proof-of-unique-human at all. Required before `earning` is enabled or any
      pool-funded payout exists. Stake-based play sidesteps this (value moves
      between players, not from a pool to players), which is a second reason to
      prefer it

### Phase C — Make the code chain-agnostic

- [ ] Un-hardcode the chain. `celo` is imported directly in ~15 files, and
      `chainId: 42220` is written literally inside `useMarketplace.ts` and
      `useResale.ts`. Mechanical but unavoidable. **MiniPay does not cover this**,
      since MiniPay is also Celo
- [ ] Contract addresses per edition rather than per env var

### Phase D — Deploy and pitch

- [ ] Deploy the contracts on Avalanche C-Chain (43114), record real addresses.
      `currency.address` is `null` on purpose — never guess a token address
- [ ] Build the staked duel loop
- [ ] Grant application. Same domain (playvalor.app) throughout: committees measure
      contribution from on-chain activity, not from which domain served the page.
      The strong pitch is "a live game with 120+ existing players, bringing them
      plus a competitive mode onto Avalanche"

---

## Sequencing at a glance

```
NOW      ask MiniPay the two questions
  │
  ├─ Phase 1  orientation        ← blocks play
  ├─ Phase 2  weight             ← blocks it being usable
  ├─ Phase 3  purchases          ← blocks it earning revenue
  └─ Phase 4  listing            ← blocks distribution
                │
                └─ Avalanche A → B → C → D
```

Phases 1 and 2 can run in parallel. Phase 3 is independent of both and could start
early if someone else takes the contract. Avalanche Phase C is the only Avalanche
work that could usefully start today, since it is pure refactoring.
