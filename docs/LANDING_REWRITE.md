# Landing Page Rewrite Plan

Copy and imagery rewrite for `apps/web/src/components/landing/LandingPage.tsx` (526 lines, 5 sections).

**Status:** Step 1 (accuracy fixes) applied. Steps 2-6 not started.
**Written:** 2026-08-09

---

## The problem

The landing page still sells the pre-pivot fantasy arena game. After the TTK pivot (2026-07-09) the
product is a first-person tactical shooter: fifteen doorkicker operations across three theatres, NVG,
ADS, suppressors. The page opens with full-bleed art of a shirtless Viking holding two bloody axes.

### Correction to an earlier draft of this document

An earlier version of this plan claimed the §3 stat bars advertised "a combat system that does not run."
**That was wrong, and it was wrong because the search was too narrow.** `CLASS_DEFINITIONS` and
`character_class` do appear nowhere in `apps/web/src/engine/`, and the FPS campaign genuinely reads only
`engine/combat/GunStats.ts` — but the stats are real on the **server**, for **duels**:

- `apps/api/src/services/battle.rs` → `calc_damage_v2(attack, defense, …)` takes `attack_stat` and
  `defense_stat` on **every PvP damage roll**.
- `move_effect()` in the same file implements all three class specials, and their marketing descriptions
  check out against the code: Berserker Rage is `base: 60.0` against a normal attack's `20.0` (so "3× base
  damage" is literally true); Iron Fortress sets `incoming_mult: 0.0` and reflects at `* 0.5`; Shadow
  Strike sets `ignore_opponent_defense` and has a lethal-special first-strike KO path, so "always strikes
  first, bypasses enemy defense" is accurate.
- `handlers/battles.rs` adds booster `stat_boost` to `attack_stat` / `defense_stat`.

**So ATK and DEF stay.** The real finding is narrower and stranger:

- **`speed_stat` is written to the DB at onboarding and then never read for any mechanic**, anywhere in
  the API or the client. SPD was the one bar of three that measured nothing.
- The `def.weapon` panels named melee gear ("Dual Battle Axes", "Sword & Tower Shield") that exists in no
  mode of the shipped game.

Lesson for the rest of this document: **grep the API too, not just `engine/`.** Valor's combat is split
across a TypeScript client and a Rust server, and a claim can be false in one and true in the other.

---

## A. The constraint that settles the imagery question

Higgsfield balance is **1.92 credits, free plan**. Generation runs ~2.5 credits, so not even one new
key-art image can be produced right now.

That removes the choice: imagery must be **real gameplay capture**. Which is the better answer anyway.
Capture converts better for a game whose appeal is how it feels to play, and it cannot drift out of sync
with the product the way the Berserker art did. Zero credits, and we already own every asset.

**Dependency:** capture undersells today because `scene.environment` is never set, so the weapon in frame
reads as grey plastic. See `docs/` notes on the visual audit. **Env map first, then shoot.**

---

## B. Accuracy audit

| Live string | Status | Why |
| --- | --- | --- |
| "Every victory pays out GoodDollar tokens — real money that goes directly into your account." | **False** | Payouts are *first clear* and *rank-up* bounties, not every victory. Replaying a cleared op pays nothing. Highest-risk string on the page: it is a money promise. |
| "…goes **directly** into your account" | **Misleading** | There is a 20% withdrawal fee routed to treasury. |
| "Real-time gun duels — your weapon and dodge timing decide who walks away." | **False** | Describes the deleted stat-duel. There is no dodge timing. Sat directly beside a picture of a man holding two axes. |
| ATK / DEF bars (§3, animated) | **True, but unscoped** | Real in duels via `calc_damage_v2` in `apps/api/src/services/battle.rs`; irrelevant to the FPS campaign. Kept, and the section sub-copy now says which mode they govern. |
| **SPD** bar (§3, animated) | **False** | `speed_stat` is written to the DB at onboarding and never read for any mechanic in the API or the client. |
| `def.weapon` panels — "Dual Battle Axes", "Sword & Tower Shield" | **False** | Melee gear that exists in no mode of the shipped game. |
| "Your class is **permanent**" · "One human. One fighter. **Forever**" (×3 placements) | **Stale** | The roster lock was lifted 2026-07-07. |
| "identity in the **arena**" | **Stale** | Arenas were superseded by the compound/ops structure and are hidden from the UI. |
| "The **first** web3 **fighting game** built exclusively for verified humans" | **Unverifiable** | Unprovable superlative, plus the wrong genre. |
| "Powered by GoodDollar · Verified Humans Only" | **Holds up** | Verified in code, not from notes: `editions/web/config.ts` sets `identity: 'gooddollar'` and the `verify` step is the default. Accurate for the web edition. It is `'none'` on MiniPay, where nothing pays out. |

### Rule on G$ figures

No rate is printed anywhere in this document on purpose. **Any number that ships must be read from the
live API or contract at the time it ships**, never carried over from a doc. Safest structure: describe the
mechanism and let the app show the amount.

---

## C. The story we are not telling

Already written in `engine/fps/campaign.ts`, and free to use.

The game is named after its antagonist. *Valor* is the voice on your radio for fifteen operations, and the
final mission is `rift-valor`: *"The voice that has been on your radio the whole way finally has a face and
a body. This is the last room. End it."*

Ember is your handler. Cinder lit the match at Ashfall. The Warden runs the Proving Ground. Three named
theatres, fifteen ops, ten weapon tiers with names like Warden's Repeater and Ember Halo, and a title that
is a double meaning.

None of this is on the landing page. Instead it opens with "One human. One fighter.", which is a policy
statement about account limits. **Lead with the twist.** "Valor is not you" is a hook; anti-bot policy is a
footnote.

---

## D. Section-by-section rewrite

Structure and animation stay throughout. The layout is good; this is a content problem. Nothing below
needs a new component.

### §1 Hero — copy

| Strike | Replace with |
| --- | --- |
| Eyebrow: "One human. One fighter." | Eyebrow: "Operation Ashfall · Active" |
| Sub: "One verified human · One fighter · Forever" | Sub: "He was the voice on your radio the whole way." |
| Chips: Berserker · Sentinel · Phantom | Chips: Ashfall · Proving Ground · The Rift |
| CTA: "Enter Valor" | CTA: "Begin Operation Ashfall" |

Keep the gold VALOR logotype and its per-letter reveal exactly as built. It is the strongest thing on the
page and it is on-brand. The class chips become the three theatres, a one-line swap into the same visual
rhythm. The CTA gains a verb.

### §1 Hero — imagery

**Strike:** four `<motion.img>` layers of Berserker/Sentinel/Phantom fantasy art with
`mixBlendMode:'screen'`, drop shadows and mask composites. Plus embers, rain and lightning.

**Replace with:** a single silent looping gameplay capture from Ashfall at golden hour, dark gradient scrim
over it, same content stack on top. Keep the ember drift, a burned village earns embers. Drop the rain and
lightning: no zone has weather.

### §2 Fight · Earn · Own

| Strike | Replace with |
| --- | --- |
| **Fight** — "Real-time gun duels, your weapon and dodge timing decide who walks away." | **Breach** — "Fifteen operations across three theatres, cleared room by room in first person. A room wakes the moment you step into it, so a bad breach is a bad fight." |
| **Earn G$** — "Every victory pays out GoodDollar tokens, real money that goes directly into your account." | **Earn** — "Clear an operation for the first time and it pays G$ on Celo. Rank up and it pays again. Withdraw to your own wallet whenever you want." |
| **Own** — "Weapons and gear are yours permanently." | **Arm** — "Ten weapon tiers, every one of them on-chain. Ashfall Carbine, Warden's Repeater, Rift Lance, Seraph, Ember Halo." |

The triad structure is good, keep it. `Crosshair` stays and earns its place now; `Gem` becomes something
weapon-shaped for Arm. The Earn line states mechanism with no figure, which is accurate and future-proof
against a rate change. Real weapon names sell harder than "permanently".

### §3 Character Showcase → Three Theatres

**Strike entirely:** eyebrow "Three Classes. One Covenant.", title "Choose Your Fighter", sub "One class.
Permanent. This is your identity in the arena." Three cards with fantasy portrait, ATK/DEF/SPD bars, and
Weapon + Special panels.

**Replace with:** eyebrow "Three Theatres. Fifteen Operations.", title "Where You'll Fight", sub "Ashfall
burns in daylight. The Proving Ground trained the men who lit it. The Rift is where Valor goes to
disappear." Three cards: gameplay still, and where the stat bars were, that theatre's real op list.

This is the section that has to die, and the replacement reuses the exact card grid. The stat bars become
the operation names, a true structure rather than a decorative one: *Breach & Clear · Hold the Line · The
Well · Smoke & Ash · Cinder* for Ashfall. The Weapon/Special footer becomes the issued weapon plus the
zone's boss. Reads as a campaign instead of a character select, and every string is lifted from
`campaign.ts`.

### §4 How It Works

| Strike | Replace with |
| --- | --- |
| 01 Prove You're Human | **Keep as written.** Accurate, and a genuine differentiator. |
| 02 **Choose Your Class** — "Berserker, Sentinel, or Phantom. Your class is permanent — it defines your identity in the arena." | 02 **Take the First Compound** — "Ashfall is five operations. Breach, clear, extract. Your rifle is issued; better ones you earn or buy." |
| 03 Battle & Earn — "Climb the ranks. Every win pays out G$…" | 03 **Climb Iron to Diamond** — "Seven ranks, then prestige. Every rank-up pays. Go quiet for three days and the ladder takes it back." |

Step 03 mentioning decay is deliberate: it is true, it is unusual, and it signals a game with stakes
rather than a faucet. Keep the GoodDollar and Celo trust bar unchanged.

### §5 CTA Footer

| Strike | Replace with |
| --- | --- |
| Eyebrow "One human. One fighter." | Eyebrow "Earn Your Honor" |
| Headline "Your Fighter Awaits" | Headline "Ashfall Is Still Burning" |
| Sub "One human. One fighter. Every victory earns real G$ on Celo. No bots. No alts. Only you." | Sub "Fifteen operations between you and the man on the radio. One verified human, one account, no bots. Free to start." |

"Earn Your Honor" is the tagline locked during the brand work and it has never appeared on the site. This
is where it belongs. The anti-bot claim survives, demoted from thesis to reassurance, which is the right
altitude for it.

---

## E. Shot list

Six captures, all from builds runnable today. Shoot at **full quality on desktop** so the post stack and
shadows are in frame, never on the `minimal` tier. Capture at 2× and downscale.

| ID | Shot | Notes |
| --- | --- | --- |
| HERO / LOOP | Ashfall, breaching the first compound | 6-10s silent loop. Weapon up, walk to the breach point, one burst, dust and tracers. Golden-hour sun at frame left. Shoot this last, after the env map lands. |
| THEATRE 01 | Ashfall in daylight | Wide, from the entry looking down the compound. Blue sky over the walls, burned ground, brick perimeter. |
| THEATRE 02 | Proving Ground at golden hour | Low warm sun raking across cover, long shadows. Our best-looking lighting setup. |
| THEATRE 03 | The Rift under NVG | NVG on, muzzle flash mid-frame. Most visually distinct thing in the game. |
| DETAIL | Weapon in ADS, held close | For the Arm card. Do not shoot before the env map: the point is that metal reads as metal. |
| DETAIL | Objective marker with the HUD live | Cyan waypoint, objective text reading BREACH THE COMPOUND. Proves the doorkicker loop in one frame. |

---

## F. Resolving the three brands

There are three identities in the repo and they cannot all survive.

1. **The gold winged-V stays the platform mark**, unchanged and genre-neutral. That was the right call for
   the multi-game plan. Rockstar's logo does not say cowboy; Red Dead's key art does. The emblem is the
   studio, the page below it is the title.
2. **Retire `Valor Banner 1.png`.** It is the only asset that currently says FPS, which is why it is
   tempting, but cyan neon HUD wireframe is a different game to the one we built: ours is dusty brick and
   golden hour.
3. **Retire the fantasy character art from all user-facing surfaces** — the landing page and
   `HomePage.tsx`'s `CLASS_SOLO`. Keep the files, they cost nothing at rest.
4. **Make the two colors a system instead of an accident.** Gold is brand, rank and money: logotype, CTA,
   G$, rank badges. Cyan is in-mission HUD: objectives, waypoints, friendlies. Both are currently true and
   never stated as a rule, which is why they read as a clash. Written down, it is an identity.

---

## G. Order of work

1. **Strike the false claims.** ✅ **DONE** — copy-only, no new assets, no dependency on anything else.
   The money promise and the phantom stat bars are the two that actually expose us.
2. **Set `scene.environment`.** ✅ **DONE** — `engine/scene/zoneEnvironment.ts` generates a prefiltered
   cubemap per zone from that zone's own sky colours, sun and ground bounce. No download, no HDRI, and
   free per frame, so it stays on at every quality tier including `minimal`. The matte compound is damped
   to `envMapIntensity: 0.25` in `triplanar.ts` so metal and matte respond differently to the same sky.
   Verified in-game A/B in Ashfall and the Rift.
3. **Purge the 184MB of dead assets** in `apps/web/public/models/`. Buys frame budget back so fewer
   players land on the `minimal` tier, and cuts load time, itself a first impression.
4. **Shoot the six captures.** Full quality, desktop, 2× and downscale.
5. **Rewrite §1 through §5.** Copy and imagery together in one pass, since half the new copy references
   the new stills.
6. **Fix `HomePage.tsx`.** The signed-in hero still serves fantasy class art via `CLASS_SOLO`. Easy to
   forget because the landing page gets all the attention.

---

## H. Open decisions

1. **Do the classes survive at all?** Decorative in the engine today but still in the DB, in onboarding,
   and on the profile. This plan assumes they stay as flavour and stop being advertised as mechanics.
   Cutting them entirely is a bigger change than a landing page and should be scoped separately.
2. **Hero: video loop or still?** A loop sells feel far better; it costs bytes and needs a poster frame
   plus a reduced-motion fallback. Recommendation: the loop.
3. **How hard do we push the story hook?** "He was the voice on your radio the whole way" spoils a reveal
   to sell the game. Most shooters make that trade.

---

## Step 1: what was actually changed

Copy-only. No imagery touched, no components added or removed, no dependency on the env map or captures.
Scoped to remove claims that are false, not to land the §D rewrite.

- **§2 Fight** → renamed **Breach**; stat-duel description replaced with the real doorkicker loop.
- **§2 Earn G$** → renamed **Earn**; the "every victory / directly into your account" money promise
  replaced with the actual first-clear + rank-up mechanism and an honest withdrawal statement. No figure.
- **§2 Own** → renamed **Arm**; now names real weapon tiers from `GunStats.ts`.
- **§2 section sub** → dropped "first web3 fighting game" (unverifiable superlative, wrong genre).
- **§3 stat bars** → **SPD removed, ATK and DEF kept.** ATK/DEF are real in duels; SPD measures nothing.
  (An earlier pass removed all three; Marvy pushed back that the comparison was the point of the section,
  which prompted the API grep and the correction above. He was right.)
- **§3 Weapon panel** → **removed** (melee gear that exists nowhere). The **Special** panel takes its place
  full-width and now shows `specialDesc` too, so each card states what the class actually *does* rather
  than just naming it. This is more differentiation than the original had, not less.
- **§3 heading copy** → dropped "permanent" and "arena"; the sub-copy now scopes the stats to duels and
  says the campaign is decided by your weapon.
- **§4 step 02** → dropped "your class is permanent / identity in the arena".
- **§4 step 03** → dropped "every win pays out"; states first-clear and rank-up instead.
- **§1 + §5** → dropped "Forever" and "Every victory earns real G$".

§3 remains class-flavoured with the fantasy portraits until step 5, because converting it to Three
Theatres needs the gameplay stills from step 4. It is now honest about mechanics; it is not yet on-genre.
