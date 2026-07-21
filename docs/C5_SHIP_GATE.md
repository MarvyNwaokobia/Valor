# C5 · Ship gate — the stranger test

> **The gate:** hand a stranger a phone with a **fresh wallet** and **zero
> instructions**. Can they finish **Operation 1** and end up with **G$ on Celo**
> without getting stuck or asking you a question?
>
> This can't be automated — it's a real person on a real device. Whatever trips
> them up **is** the remaining ship work. Watch silently; don't coach. Note every
> hesitation.

## How to run it

- Use a **real phone** (ideally a mid-range Android + an iPhone in Safari), on
  cellular or a different network than yours.
- Use a **brand-new Google account / wallet** the tester has never used, so you
  see true first-run onboarding (not your cached session).
- Open **https://playvalor.app** and hand it over. Start a stopwatch.
- Success = they reach "I have G$" on their own. Record **where they paused**,
  **what they tapped that did nothing**, and **time-to-first-G$**.

## The path they must complete (and what watches each step)

1. **Landing / cold start.** First hit may spin up the free API (~50s) — a banner
   should explain the wait. *Watch: do they think it's broken and leave?*
2. **Sign in.** Magic login (Google / email), no seed phrase. *Watch: does login
   work on mobile Safari (ITP has bitten us) without a dead-end?*
3. **Verify identity.** GoodDollar humanity check (anti-Sybil, required before G$).
   *Watch: is the "why am I doing this" clear? Does the verify hand-off return
   cleanly to Valor?*
4. **Confirm character + username.** A fresh wallet goes to character select and is
   auto-confirmed; they pick a name. *Watch: is it obvious this is a one-time
   setup, not a paywall?*
5. **Into the fight.** Dashboard → Fight → Campaign → Operations list → **Op 1** →
   the game boots straight in. *Watch: do they find "how do I actually play"?*
6. **Play Op 1.** Portrait shows a rotate prompt; then joystick (left) + drag-to-aim
   (anywhere over the gun) + fire (right). Clear the rooms → MISSION COMPLETE.
   *Watch: do they discover aiming? Does the landscape gate confuse or help? Does
   it hold a smooth frame rate (see perf check below)?*
7. **Reward lands.** The server applies XP → rank → G$ and the one-time **first-clear
   bounty (2 G$)** on-chain; the in-game rank bar reflects the real account (C1).
   *Watch: do they SEE that they earned something?*
8. **They have G$.** The bounty (and any daily claim) shows as real G$ on Celo.
   *Watch: is the balance legible? Does "I earned money" actually register?* ← the
   gate.

## Known friction points (most likely to fail first)

- **API latency / first request after a deploy** — Railway Hobby doesn't sleep, so
  there's no cold-start wait, but a fresh deploy still takes a moment to go live. If
  testers hit an error right after a push, give the rollout a few seconds.
- **Mobile Safari + Magic** — login and any live on-chain read can be flaky under
  ITP; read-only checks already use plain HTTP clients, but re-watch login itself.
- **The verify step** — the biggest "wait, what is this?" moment for a normal person.
- **Discovering aim** — drag-anywhere-over-the-gun + touch aim-assist exist, but a
  first-timer may not realize they can aim. If several miss it, add a 2-second hint.
- **Bounty is async** — the 2 G$ lands a few seconds after MISSION COMPLETE (on-chain).
  If the UI looks "done" before the money shows, they may not connect the two.
- **The wallet address** taps to a Copy / Sign-out menu (not an instant sign-out) —
  confirm a curious tap there doesn't strand them.

## Pass criteria

- [ ] Reached the game and cleared Op 1 **without being told how**.
- [ ] Ended with **G$ on Celo** they can see.
- [ ] No dead-ends, no "is it broken?", no rescue from you.
- [ ] Held a playable frame rate on the device (amber/green on the perf meter).

If any box fails, that step is the next thing to fix — then re-run with a new tester.

## On-device checks to bundle into the same session

These need a real device too, so do them alongside the stranger test:

- **C3 perf** — open `playvalor.app/fight?op=1&perf=1`; a meter shows top-left.
  Play a busy wave and confirm it holds **≥30 FPS** (amber/green, not red). Note any
  spot that dips red (a specific wave / the Rift) so it can be tuned.
- **B1 re-arm (sink)** — Fight → Survival → play until you die → tap **REVIVE** →
  approve the ONE signature (arm cap) → you continue. Then confirm the RewardPool
  balance ticked up by the cost and your Bank ledger shows a `survival_rearm` debit.
- **B3 season payout (money-touching, admin)** — from an `ADMIN_WALLET`: admin login
  → `POST /admin/seasons {name}` → `/admin/seasons/:id/fund {prize_pool_g}` → play a
  couple of Gauntlet runs → `/admin/seasons/:id/end` → `/admin/seasons/:id/payout`.
  Watch the chain for `BountyDistributed` events; the top runs should receive G$.
  (Do this on a small pool first.)

## Notes

- The onboarding matrix (old/reconstructed wallet → Confirm Character; new wallet →
  character select; verified → no re-verify; mobile address → menu) was already
  spot-checked and passed — C5 is the *end-to-end, no-instructions* version.
- Identity verification is LIVE; do not disable it. Never force re-verify on your own
  (only GoodDollar's own expiry may prompt it).
