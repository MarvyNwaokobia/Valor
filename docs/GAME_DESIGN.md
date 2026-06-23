# VALOR — Game Design Document

> **One sentence:** Valor is a real-time 1v1 fighting game with a Mortal Kombat feel,
> playable in the browser, where verified humans fight, climb ranked seasons, and earn
> real value (G$) on GoodDollar + Celo.

This document describes the game we are actually building. It supersedes all earlier
"arena shooter" and "RPG class" drafts — those directions are abandoned.

---

## 1. The Core Fantasy

Two warriors. One arena. Real-time, weighty, brutal melee combat that hits like
Mortal Kombat — anticipation, contact, hitstop, follow-through, finishers. You read
your opponent, you punish their mistakes, you chain your hits, you win the round.

The crypto is invisible. You connect with a social login, you fight, you earn. The
blockchain is under the hood.

---

## 2. Combat Model — REAL-TIME (not turn-based)

This is the central design commitment. Combat is **real-time**, not menu-driven.

- Each fighter is controlled in real time (keyboard/mouse on desktop, on-screen
  controls on mobile via `TouchControls`).
- The feel comes from frame data, not stats: anticipation frames → active hitbox →
  recovery, with **hitstop on contact**, screen punch, and knockback.
- Damage lands when the blow visually connects (driven off the animation's normalized
  time on a single `dt` clock — see the game-feel notes), never from an independent
  timer.

### Inputs / Moves
- **Light Attack** — fast, low commitment, chains into combos.
- **Heavy Attack** — slow, high damage, can launch.
- **Special** — class-defining signature move (see classes).
- **Block**, **Dodge** (real dodge clip — sidestep/backstep/roll, never a slide).
- **Jump** + **Jump Attack**.
- **Movement** — Walk / Run, grounded to their clips (no sliding).

### Combo & reaction system (already in the engine)
- `ComboSystem` + `CLASS_FRAME_DATA` drive MK-style chains (light→light→heavy→launcher).
- Launchers open juggle windows.
- `DamageSystem` + `HitboxSystem` resolve contact; `KnockbackPhysics` handles
  stagger / knockback / knockdown.
- Defenders **react** to every landed hit (directional hit-reactions), never stand
  still eating damage. Both fighters act simultaneously.

### Match structure
- **Best-of-3 rounds.** First to win 2 rounds takes the match.
- Round timer; most HP wins on timeout.
- Round-end / match-end states drive the reward flow (§6).
- **Finisher** opportunity on the killing blow (the MK signature — see §7 roadmap).

---

## 3. Classes (3 — matches the code)

Three fighters, each a distinct silhouette + color + moveset. Identity must read from
the silhouette and accent color, not just the moveset.

| Class | Color | Stats (atk/def/spd) | Weapon | Special | Playstyle |
|-------|-------|---------------------|--------|---------|-----------|
| **Berserker** | Red `#ef4444` | 16 / 7 / 9 | Dual Battle Axes | **Berserker Rage** — burst damage window | Aggressive — win fast or fall hard |
| **Sentinel** | Blue `#3b82f6` | 9 / 16 / 7 | Sword & Tower Shield | **Iron Fortress** — absorb + reflect | Defensive — outlast and punish |
| **Phantom** | Purple `#8b5cf6` | 12 / 7 / 15 | Twin Void Blades | **Shadow Strike** — fast gap-close burst | Evasive — speed is your armor |

> Note: in a real-time fighter, "special" abilities are **real moves with frame data**,
> not turn-resolved effects. The old taglines ("always strikes first", "reflects 50%")
> must be re-expressed as real-time mechanics (e.g. Iron Fortress = a timed parry stance
> that reflects on success).

Each class fights on a signature stage: Berserker → lava arena, Sentinel → battle
arena, Phantom → sci-fi stage.

---

## 4. Game Modes

1. **Ranked 1v1 (PvP)** — the heart of the game. Climb the ranked ladder, earn G$.
   Requires GoodDollar verification.
2. **Quick Fight (PvE / unranked)** — fight the AI (`EnemyAI`, difficulty tiers) or an
   unranked opponent. Warm up, learn a class, test combos.
3. **Tutorial — "The Gauntlet"** — teaches movement, attacks, blocking, dodging,
   specials, and one scripted fight (`useTutorialBattle` / `TutorialArena`).

PvP netcode model is the key open decision (§8).

---

## 5. Progression & Ranked

- **Player Level / XP** — earned every fight, win or lose (no wasted sessions).
- **Ranked tiers** — Bronze → … → Valor, seasonal soft resets. (Existing rank pool
  logic in `useRankPool` / API carries over.)
- **Decay** — inactivity decay already exists; recovery on return.
- **Achievements** — milestone rewards.

---

## 6. Web3 / Economy (GoodDollar + Celo)

- **Identity:** wallet = permanent identity (Privy: social login → embedded wallet, or
  connect existing). GoodDollar verification gates ranked + G$ (one human, one account;
  no bots/multi-accounting).
- **Rewards:** G$ on Celo for wins, ranked placement, challenges. Server-authoritative
  reward resolution (anti-cheat).
- **Migration note:** rewards (XP / rank / G$) are currently wired to the retired
  turn-based "Classic" battle. They must be **re-wired onto the real-time fighter**
  before Classic is removed (§8).

`G$ on Celo: 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A (18 decimals)`

---

## 7. Game Feel — the MK bar (the real work)

Feel is ~70% code, and it's the priority. From the diagnosis:

1. **Single clock.** Drive damage / recovery / cancel windows off the animation's
   normalized time on one `dt` clock. Remove every combat `setTimeout` (they ignore
   hitstop). *(Root-cause fix — do before tuning anything.)*
2. **No sliding.** Keep planar root motion on attacks/dodges; strip only vertical float.
   Match move/dodge speeds to clip cadence.
3. **Cancel windows.** Buffered inputs chain; attacks accept input before fully ending.
4. **Impact layer (procedural juice):** hitstop with held frame, scale-punch on impact,
   procedural lean/recoil, layered impact SFX (`CombatAudio`), contact-point VFX
   (`ParticleSystem`), screen shake / `BattleCamera.punch()`.
5. **Readability:** distinct silhouettes + accent colors; pull the camera in (less
   RTS-like); brighter, textured arenas with scale reference; tune weapon trails
   (`TrailRenderer`).
6. **Default = combat stance** (fightIdle), never casual idle or T-pose, when the match
   is live.

**Animation sourcing:** keep Mixamo for locomotion/reactions; author/edit the 3–5
signature attacks per class (Cascadeur or Blender) for anticipation + held impact +
clamped follow-through.

**Roadmap polish (post-feel):** finishers / fatalities on the killing blow — the MK
signature and a natural fit for a per-class "finisher animation" + dramatic camera.

---

## 8. Open Decisions / Next Steps

1. **PvP netcode** — real-time authoritative netcode is hard *and* there's real money at
   stake. Decide: rollback/lockstep real-time, or "real-time play, server-validated
   result." This gates real Ranked PvP. (AI fights work today regardless.)
2. **Reward rewiring** — move XP/rank/G$ from the turn-based path onto the real-time
   fighter, then retire Classic from the home screen.
3. **Specials as real-time mechanics** — re-express the three class specials as moves
   with real frame data (§3).
4. **Finisher system** — design + implement (§7 roadmap).

---

## 9. Existing Foundation (what we keep)

- **Next.js 15** web app (`apps/web`) + **Three.js / R3F** engine (`apps/web/src/engine/`):
  `combat/` (ComboSystem, DamageSystem, HitboxSystem, MoveRegistry, ClassAbilities,
  EnemyAI), `animation/` (AnimationStateMachine, MixamoLoader, CLASS_ANIMATIONS),
  `camera/` (BattleCamera), `vfx/` (CombatFeel, KnockbackPhysics, TrailRenderer,
  ParticleSystem, ScreenEffects), `audio/` (CombatAudio), `world/` (ArenaManager,
  StageLighting, Crowd), `input/`, `scene/` (GameScene, FighterModel, ArenaStage).
- **Privy** auth, **GoodDollar** SDK, **Supabase/Postgres**, **API** (`apps/api`),
  **contracts/** (Foundry), **packages/shared**.
- Entry point for the real-time fighter: `/fight` → `GameScene`.
