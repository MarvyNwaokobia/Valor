# Valor PvP Netcode — Scoping

> Status: scoping / decision pending. This documents the current state, the core
> tension, the realistic options, and a recommended phased path. No netcode work
> is committed yet beyond the scaffolding described below.

## TL;DR

Valor is a real-time 1v1 fighter with **real money (G$) on the line**. That fact
forces the netcode choice: ranked matches must be **server-authoritative** —
rollback/peer-to-peer models let clients own the simulation, which is exploitable
when rewards are real. The repo already pointed at server-authoritative + client
prediction, but it's **half-built in two mismatched halves**.

The real decision is **where the authoritative combat sim runs and how rich it
is**, because the rich MK combat we just built (frame data, hitboxes, cancels,
juggles, knockback) lives entirely in client TypeScript. Recommendation: run that
**same TS engine headless on a realtime server as the authority** (one engine, not
two), phase it in casual → ranked, and ship **async-simulated PvP** as the interim
competitive loop.

## Current state (what actually exists)

**Transport:** `useGameSocket` (client WS), `handlers/ws.rs` (server WS handler),
`services/game_server.rs` (the game-room task, `GameServerHandle`).

**Server — `game_server.rs` (simple action model, ~working):**
- Matchmaking queue → 2 players → room → 3s countdown → `fight_start` → 60s timeout.
- Clients send discrete actions (`"attack"`/`"block"`/`"special"`). Server enforces
  cooldowns, computes damage server-side (`rand_dmg` − defense), applies HP,
  broadcasts `action_result`, ends on HP≤0 or timeout, awards XP/rank, persists the
  battle (`is_bot=false`).
- **No spatial simulation**: no movement, positions, facing, hitboxes, ranges,
  whiffs, combos, or cancels. Attacks auto-hit (minus a block window). It is
  essentially the turn-based damage model triggered in real time.

**Client — `CombatProtocol.ts` + `ClientPrediction.ts` + `PvPManager.ts` (a
different, fuller model):**
- Up: `InputState` (moveX/Y, rotation, actions, seq) and `ActionTrigger`.
- Down: `StateUpdate` (positions, velocity, animState, health) and `HitConfirm`
  (hitbox-precise damage/knockback/kill).
- `ClientPrediction` implements proper prediction (input buffer + server
  reconciliation via replay) and remote entity interpolation (100 ms buffer).

**The mismatch:** the client prediction layer expects authoritative
positions/hit-confirms the server never sends (the server only emits HP-based
`action_result`). So today PvP is two disconnected halves; neither is end-to-end.

## The core tension (why this is hard for a fighter)

1. Fighting games are the most latency-sensitive genre — every added RTT on a hit hurts.
2. Money at stake ⇒ anti-cheat is mandatory for ranked ⇒ the sim must be
   **server-authoritative** (never trust a client with outcomes).
3. Server-authority adds latency exactly where fighters hurt most.
4. **Rollback (GGPO)** gives the best feel but is peer-authoritative (clients own
   the sim) ⇒ unacceptable for money ranked, and needs full determinism (today
   blocked by float discipline + `Math.random` in damage variance).
5. The rich MK combat lives in client TS (`engine/`). For the server to be
   authoritative over *that* combat, the server must *run* that sim — it doesn't;
   `game_server.rs` is a simplified auto-hit model.

## Options — the decision is where/how rich the authoritative sim is

**A. Action-lite server-auth (extend `game_server.rs`).** Keep the auto-hit action
model; maybe add a distance check so attacks can whiff.
- ✅ Cheapest, cheat-resistant, partially built.
- ❌ Ranked combat ≠ the PvE fighter — no spacing/hitboxes/combos server-side. Two
  different "games"; throws away the MK feel for ranked. Not a destination.

**B. Full authoritative sim ported to Rust.** Reimplement the combat engine (frame
data, hitboxes, movement, cancels, knockback, locomotion) in Rust; clients predict
+ reconcile.
- ✅ Best: identical feel + full anti-cheat + Rust perf.
- ❌ A second combat engine to build and keep in lockstep with the TS one forever;
  any divergence = desync. High cost + permanent maintenance tax.

**C. Authoritative sim in Node, reusing the TS engine (RECOMMENDED).** Run the same
combat engine headless (no Three/DOM) on a realtime Node server as the authority;
clients send inputs, predict locally, reconcile against server state.
- ✅ One engine = one source of truth for feel; full server-auth anti-cheat; reuses
  the already-drafted `ClientPrediction`/`CombatProtocol`.
- ❌ Must refactor the engine to run headless on a fixed server tick; stand up Node
  realtime infra; polish prediction/reconciliation. Medium-high — but the only path
  that preserves the MK feel without maintaining two engines.

**D. Hybrid — rollback P2P for casual, server-sim for ranked.** Best-feel casual
(no money) + authoritative ranked.
- ✅ Great casual feel + safe ranked.
- ❌ Two netcode paths; rollback needs the determinism work. A later luxury.

**E. Async simulated PvP (interim — already exists).** `challenge_player` /
`simulate_async_fight` resolves a match from both players' stats/loadouts
server-side; no live fighting.
- ✅ Ships now, trivially cheat-proof, gives a competitive G$ loop.
- ❌ Not real-time, no MK feel vs humans. A labeled interim "ranked," not a destination.

## Recommended path (phased)

- **Phase 0 — interim competitive loop (days):** ship **async simulated PvP (E)** as
  clearly-labeled "Ranked (async)" so there are player-vs-player stakes + G$ before
  real-time lands. Reuses existing code.
- **Phase 1 — real-time casual (weeks):** lay the **C** foundation — reconcile the
  protocol, run the headless TS engine authoritatively for **unranked** (no money).
  Learn matchmaking, regions, disconnect/timeout handling, and how prediction feels
  at real latency, while stakes are low.
- **Phase 2 — real-time ranked (the milestone):** harden C; add full
  anti-exploitation (min match time, daily G$ cap, AFK/leaver handling, GoodDollar
  verification gate); gate ranked G$ behind it. The just-shipped reward loop
  (`finalize_fight`) plugs in here — authoritative PvP `MatchEnd` awards via the
  same server-authoritative path.
- **Defer D** (rollback casual) until casual feel demands it.

## Determinism note

Server-auth (B/C) does **not** require cross-client determinism — the server is the
single truth, and VFX/audio RNG can stay client-only. Only rollback/lockstep (D)
needs full determinism, which today is blocked by `Math.random` in damage variance
+ floating-point discipline. Choosing C keeps determinism out of the critical path.

## Decisions to make

1. **Authoritative sim location: C (Node, shared TS engine) vs B (Rust port) vs A
   (action-lite).** ← the pivotal one; everything else follows.
2. Realtime transport: extend the existing actix `ws.rs` (Rust) for
   matchmaking/relay vs a dedicated Node realtime framework (Colyseus / socket.io).
   C implies a Node sim host; the Rust WS can stay for matchmaking or be replaced.
3. Ship async PvP (E) as interim ranked now? (recommended: yes)
4. Casual-before-ranked phasing? (recommended: yes)
5. Hosting/regions: single region first, regional matchmaking later.

## Concrete next steps if C is chosen

1. Reconcile `CombatProtocol` ↔ server onto one message set; retire the action-model
   server (or repurpose it purely for matchmaking).
2. Extract the sim from rendering: a headless `stepCombat(dt, inputs)` runnable with
   no Three/DOM. `FighterModel`/VFX/audio become client-only consumers of state.
3. Stand up a Node realtime room server that ticks the headless sim at fixed dt,
   ingests `InputState`, broadcasts `StateUpdate`/`HitConfirm`.
4. Wire `ClientPrediction` (already drafted) for the local player + interpolation for
   the remote.
5. Route authoritative `MatchEnd` into `finalize_fight` so PvP awards XP/rank/G$ via
   the same server-authoritative reward path used by the live fighter today.
