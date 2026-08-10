# Classes: what they are, what they aren't

**Status:** design note, discussed 2026-08-10. Nothing here is built. Captures a decision about what the
class system should be, so the next person doesn't re-litigate it.

---

## Where the class is actually visible

Established by reading the code, not by assumption. This is the whole basis for the decision.

| Surface | Class visible? | Notes |
| --- | --- | --- |
| **FPS campaign** | **No** | `ValorScene` never loads a class GLB. The viewmodel is procedurally-built gloved hands (`engine/scene/viewmodelHands.ts`), identical for every class. You never see your own body. |
| **Duels (PvP)** | **Yes** | Third-person; the class model renders (`components/battle/BattlePvP.tsx`). Class also decides the fight — see below. |
| **Leaderboard** | Yes | `components/leaderboard/LeaderboardTable.tsx` |
| **Shareable player card** | Yes | `components/player-card/PlayerCard.tsx` — the surface that leaves the app |
| **Profile / nav chrome** | Yes | `views/ProfilePage.tsx`, `components/layout/Navbar.tsx` |

### Where the class decides outcomes

Only in duels, and only on the server: `apps/api/src/services/battle.rs`.

- `calc_damage_v2(attack, defense, …)` consumes `attack_stat` and `defense_stat` on every PvP damage roll.
- `move_effect()` implements the three specials: Berserker Rage (`base: 60.0` vs a normal attack's
  `20.0`), Iron Fortress (`incoming_mult: 0.0` plus a 50% reflect), Shadow Strike (ignores defense,
  bypasses mitigation, lethal-special first-strike KO).
- `handlers/battles.rs` adds booster `stat_boost` to attack/defense.
- **`speed_stat` is written at onboarding and never read for any mechanic**, anywhere.

---

## The decision

**The class is a profile identity, not a gameplay identity.** It is your operator on the scoreboard, not
your hitbox. Three separate systems, each legible on its own:

1. **Campaign is decided by your weapon.** Skill and gear. Class is irrelevant, which is already true —
   the FPS reads `engine/combat/GunStats.ts` and nothing else.
2. **Duels are decided by your class.** Stats and specials. This is the only texture duels have and it is
   worth keeping.
3. **Class is your face everywhere else.** Card, leaderboard, profile.

### Consequences

- **One character, nothing running in the background.** No roster. The schema already agrees: a single
  `character_class` column. The 3-fighter roster was abandoned 2026-07-07 and should not come back.
- **Chosen once at onboarding**, then it is simply who you are.
- **Do NOT make class stats affect the FPS campaign.** This was floated (making `speed_stat` drive
  movement or ADS speed) and rejected: it would let a first-timer's blind pick silently handicap them
  across fifteen missions, and it would put balance pressure on the campaign for no gain.

---

## Changing your operator: sell them in the marketplace

Endorsed direction, not yet built.

Buy a different operator in the marketplace. Previously-owned ones stay owned but dormant; exactly one is
active at a time. This is how skins work in every shooter and it is the least confusing model.

**Why it is worth building:**

- **The schema already anticipates it.** `types/database.ts` types `CharacterClass` as six values:
  `Berserker | Sentinel | Phantom | Warden | Specter | Vanguard`. Three unbuilt operators already have
  names.
- **It is a G$ sink, and sinks are the active economic problem** (outflow ~18.6:1 out vs in, which is why
  the 20% withdrawal fee shipped). A purchase removes G$ from circulation for something players want. A
  better sink than a fee: a fee feels like a tax, a new operator feels like a reward.
- **It fixes a real design flaw.** Today the class is an irreversible choice made before the player has
  played a single minute. Making it purchasable turns an uninformed permanent decision into a reversible
  one.

### The trap to avoid

**If class decides duel damage, selling classes is selling power.** Current spreads are not balanced:

| Class | ATK | DEF | Total |
| --- | --- | --- | --- |
| Berserker | 16 | 7 | 23 |
| Sentinel | 9 | 16 | 25 |
| Phantom | 12 | 7 | 19 |

Phantom is weakest on raw stats and compensates with the strongest special. That is tolerable while every
class is free and picked blind. It is **not** tolerable once players can buy the winner — the best one
becomes mandatory.

**If operators become purchasable, equalize the stat budget** and let them differ by distribution and
special, not by total.

Also unresolved: onboarding adds a random `variance` to stats, so two Berserkers are not identical.
Decide whether buying an operator re-rolls that.

---

## Open

- Balance pass on the stat budget (blocking for marketplace operators, not for anything else).
- Do Warden / Specter / Vanguard get built, and what are their specials?
- Does a purchased operator re-roll stat variance?

Related: `docs/LANDING_REWRITE.md` (the landing copy already reflects this split — §3 scopes the stats to
duels and says the campaign is decided by your weapon).
