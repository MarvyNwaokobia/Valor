/**
 * @module campaign/levels
 * @description The PvE Campaign Ladder — 15 hand-tuned levels (expandable).
 *
 * "Fight a Bot" becomes "Campaign": the player fights the next uncleared level or
 * replays a cleared one. Difficulty ramps on four axes AT ONCE — enemy gun tier,
 * AIDifficulty, HP multiplier and class — so a higher level FEELS harder, not just
 * bigger-numbered. The real gate is the player's own gun: early levels fall to the
 * starter sidearm, mid-game levels out-DPS it until the player buys/earns a stronger
 * gun in the marketplace (the core economic loop).
 *
 * Bosses sit on every 5th level (5/10/15): more HP, a signature gun, their own stage.
 * Boss reward is XP ONLY — G$ comes solely from the existing rank-up at 1000 XP (see
 * the project-shooter-pivot memory). `xpReward` is the base_xp passed to
 * POST /battles/fight/complete on a win; a loss falls back to the server's +30.
 *
 * Beyond level 15 the player unlocks Endless mode (separate module) for the
 * all-time + weekly leaderboards.
 */

import { AIDifficulty } from '../combat';
import type { GunId } from '../combat/GunStats';
import type { StageId } from '../scene/ArenaStage';
import type { ClassId } from '../sim/CombatSim';

export interface CampaignLevel {
  level: number;          // 1-based ladder position
  name: string;
  enemyClass: ClassId;
  enemyGun: GunId;        // gun tier the bot is equipped with
  enemyHpMult: number;    // multiplies the class base HP
  difficulty: AIDifficulty;
  xpReward: number;       // base_xp on a win (first clear adds a one-time bonus)
  isBoss: boolean;
  stageId: StageId;
}

/** One-time XP bonus granted the first time a level is cleared. */
export const FIRST_CLEAR_BONUS_XP = 50;

/** Clear this level → Endless mode unlocks. */
export const ENDLESS_UNLOCK_LEVEL = 15;

export const CAMPAIGN_LEVELS: readonly CampaignLevel[] = [
  // ── Zone 1 · Ashfall (lava_arena) — learn to shoot & dodge ──
  { level: 1,  name: 'First Contact', enemyClass: 'sentinel',  enemyGun: 'sidearm',       enemyHpMult: 0.9, difficulty: AIDifficulty.Easy,   xpReward: 80,  isBoss: false, stageId: 'lava_arena' },
  { level: 2,  name: 'Skirmish',      enemyClass: 'phantom',   enemyGun: 'sidearm',       enemyHpMult: 1.0, difficulty: AIDifficulty.Easy,   xpReward: 90,  isBoss: false, stageId: 'lava_arena' },
  { level: 3,  name: 'Pressure',      enemyClass: 'berserker', enemyGun: 'sidearm',       enemyHpMult: 1.1, difficulty: AIDifficulty.Medium, xpReward: 100, isBoss: false, stageId: 'lava_arena' },
  { level: 4,  name: 'Spray',         enemyClass: 'phantom',   enemyGun: 'smg',           enemyHpMult: 1.1, difficulty: AIDifficulty.Medium, xpReward: 115, isBoss: false, stageId: 'lava_arena' },
  { level: 5,  name: 'BOSS · Cinder', enemyClass: 'berserker', enemyGun: 'smg',           enemyHpMult: 1.6, difficulty: AIDifficulty.Hard,   xpReward: 200, isBoss: true,  stageId: 'lava_arena' },

  // ── Zone 2 · The Proving Ground (battle_arena) — guns get serious ──
  { level: 6,  name: 'Regroup',       enemyClass: 'sentinel',  enemyGun: 'smg',           enemyHpMult: 1.2, difficulty: AIDifficulty.Medium, xpReward: 120, isBoss: false, stageId: 'battle_arena' },
  { level: 7,  name: 'Rifle Drill',   enemyClass: 'berserker', enemyGun: 'assault_rifle', enemyHpMult: 1.3, difficulty: AIDifficulty.Medium, xpReward: 135, isBoss: false, stageId: 'battle_arena' },
  { level: 8,  name: 'Crossfire',     enemyClass: 'phantom',   enemyGun: 'assault_rifle', enemyHpMult: 1.4, difficulty: AIDifficulty.Hard,   xpReward: 150, isBoss: false, stageId: 'battle_arena' },
  { level: 9,  name: 'No Cover',      enemyClass: 'sentinel',  enemyGun: 'assault_rifle', enemyHpMult: 1.5, difficulty: AIDifficulty.Hard,   xpReward: 165, isBoss: false, stageId: 'battle_arena' },
  { level: 10, name: 'BOSS · Warden', enemyClass: 'sentinel',  enemyGun: 'assault_rifle', enemyHpMult: 2.0, difficulty: AIDifficulty.Hard,   xpReward: 250, isBoss: true,  stageId: 'battle_arena' },

  // ── Zone 3 · The Rift (scifi_stage) — top-tier hardware ──
  { level: 11, name: 'Long Shots',    enemyClass: 'phantom',   enemyGun: 'marksman',      enemyHpMult: 1.5, difficulty: AIDifficulty.Hard,   xpReward: 170, isBoss: false, stageId: 'scifi_stage' },
  { level: 12, name: 'Deadeye',       enemyClass: 'berserker', enemyGun: 'marksman',      enemyHpMult: 1.6, difficulty: AIDifficulty.Hard,   xpReward: 185, isBoss: false, stageId: 'scifi_stage' },
  { level: 13, name: 'Prototype',     enemyClass: 'sentinel',  enemyGun: 'legendary',     enemyHpMult: 1.7, difficulty: AIDifficulty.Hard,   xpReward: 200, isBoss: false, stageId: 'scifi_stage' },
  { level: 14, name: 'Last Stand',    enemyClass: 'phantom',   enemyGun: 'legendary',     enemyHpMult: 1.8, difficulty: AIDifficulty.Boss,   xpReward: 220, isBoss: false, stageId: 'scifi_stage' },
  { level: 15, name: 'BOSS · Valor',  enemyClass: 'berserker', enemyGun: 'legendary',     enemyHpMult: 2.4, difficulty: AIDifficulty.Boss,   xpReward: 300, isBoss: true,  stageId: 'scifi_stage' },
];

export const CAMPAIGN_LENGTH = CAMPAIGN_LEVELS.length;

export function getLevel(n: number): CampaignLevel | undefined {
  return CAMPAIGN_LEVELS.find((l) => l.level === n);
}

// ── Endless mode ────────────────────────────────────────────────────────────
const ENDLESS_CLASSES: ClassId[] = ['berserker', 'sentinel', 'phantom'];
const ENDLESS_STAGES: StageId[] = ['lava_arena', 'battle_arena', 'scifi_stage', 'industrial_hangar'];

/**
 * Synthetic, infinitely-scaling enemy for Endless wave `w` (1-based). Always the
 * top-tier gun + Boss AI, with HP ramping each wave. Not a Campaign level — Endless
 * tracks a leaderboard score (waves survived), not pve_level unlocks.
 */
export function endlessLevel(w: number): CampaignLevel {
  return {
    level: w,
    name: `Wave ${w}`,
    enemyClass: ENDLESS_CLASSES[w % ENDLESS_CLASSES.length],
    enemyGun: 'legendary',
    enemyHpMult: 1.8 + w * 0.22,
    difficulty: AIDifficulty.Boss,
    xpReward: 50,
    isBoss: w % 5 === 0,
    stageId: ENDLESS_STAGES[w % ENDLESS_STAGES.length],
  };
}
