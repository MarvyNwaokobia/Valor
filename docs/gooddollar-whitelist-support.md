# GoodDollar support: whitelist expiring within days on app-created (Magic) wallets

**Chain:** Celo mainnet
**Identity contract:** `0xC361A6E67822a0EDc17D899227dd9FC50BD62F42`
**UBIScheme:** `0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1`
**Our app:** Valor (playvalor.app). Users sign in with Magic embedded wallets and verify via `IdentitySDK.generateFVLink(...)`.

## The problem

Users complete face verification, claim UBI successfully, then within a few days can no longer claim — GoodDollar reports them as **not whitelisted** again. `authenticationPeriod()` returns **180**, so we expected verification to last ~180 days, but the whitelist is lapsing in **3–6 days**.

We checked 9 of our wallets that had all successfully claimed UBI: **4 of 9 (~44%) now return `getWhitelistedRoot = 0x0` and `isWhitelisted = false`**, despite each having claimed within the last week.

## Forensic detail on one wallet

Wallet: `0xF616EA106DfBC506Bb0fF71199373c7452385681`
- `lastAuthenticated` = **2026-07-12 07:36:53 UTC**
- Successfully claimed UBI **2026-07-12 17:50 UTC** (so it was whitelisted then; confirmed `getWhitelistedRoot` = self at that block).
- We binary-searched the exact block where `getWhitelistedRoot` flipped from **self → `0x0`**: **block 72200255, 2026-07-15 07:36:53 UTC** — which is **exactly 3 days (259200s) after `lastAuthenticated`.**
- **There is no transaction or event on the Identity contract at that block** — the value simply *computed* to zero as time passed. So this is a time-based expiry in contract state, not an explicit `removeWhitelisted` call and not (as far as we can tell) a face-dedup event.
- Yet `checkEntitlement` still returns ~130 G$ for this wallet, which it cannot claim while un-whitelisted.

## What's confusing us

1. `authenticationPeriod()` = 180 (days), but the whitelist is lapsing at ~3 days. What actually governs when `getWhitelistedRoot` / `isWhitelisted` returns not-whitelisted for these wallets?
2. It is **not uniform**: among our wallets, some that last authenticated **8, 16 days ago are still whitelisted**, while ones from **4–6 days ago are not**. A 16-day wallet is whitelisted and a 4-day one is not — so it isn't a simple per-wallet timer.
3. Did something change around **2026-07-15** that un-whitelisted a cohort? Or is there a shorter effective re-authentication window for app-created wallets that we're missing?

## Our questions

- What is the real expiry rule for the whitelist (the signal `getWhitelistedRoot`/`isWhitelisted` use), for wallets verified through an integrated app via `generateFVLink`?
- Is there a required periodic re-authentication shorter than `authenticationPeriod`, or a "connected wallet" model we need to use so an embedded Magic wallet stays whitelisted?
- Is there anything about how our users verify (embedded wallets, possibly the same person verifying more than one wallet) that would cause GoodDollar to drop the whitelist early?

Happy to share more wallets / block data. Thank you.
