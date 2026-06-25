/**
 * @module GunStats
 * @description Weapon stat blocks for the ranged stat-duel.
 *
 * In the shooter pivot, a fighter's GUN — not their class — is the primary source
 * of combat power. The headless CombatSim resolver consumes these numbers to drive
 * fire cadence, projectile travel, hit chance and damage; class becomes flavour
 * layered on top (e.g. Phantom = longer dodge i-frames, Sentinel = more HP).
 *
 * Guns are class-AGNOSTIC: any fighter can equip any gun. The marketplace sells
 * them by tier, and the PvE Campaign (engine/campaign/levels.ts) gates progression
 * behind acquiring stronger tiers — that demand is the core economic loop.
 *
 * All numbers here are FIRST-PASS and meant to be tuned. `gunDps()` is the headline
 * "power" figure the marketplace sorts/level-gates on. Fire is travel-time, not
 * hitscan, so `projectileSpeed` is a real balance lever: slower rounds are more
 * dodgeable.
 */

export type GunId = 'sidearm' | 'smg' | 'assault_rifle' | 'marksman' | 'legendary';

export interface GunStats {
  id: GunId;
  name: string;
  tier: number;            // 1..5 — marketplace + level gating
  damage: number;          // HP per landed shot (before crit)
  fireRate: number;        // rounds per minute → shot cooldown = 60 / fireRate
  accuracy: number;        // 0..1 hit chance when the target is NOT dodging
  projectileSpeed: number; // m/s — travel-time, not hitscan; lower = easier to dodge
  range: number;           // m of full damage; damage falls off beyond this
  critChance: number;      // 0..1
  critMult: number;        // damage multiplier on a crit
  magazine: number;        // shots before a reload
  reloadTime: number;      // seconds to reload
}

/**
 * Sustained DPS including reload downtime and expected accuracy/crit — the single
 * "power" number the marketplace sorts and the Campaign gates on.
 */
export function gunDps(g: GunStats): number {
  const secsPerMag = g.magazine / (g.fireRate / 60) + g.reloadTime;
  const expectedPerShot = g.damage * g.accuracy * (1 + g.critChance * (g.critMult - 1));
  return (g.magazine * expectedPerShot) / secsPerMag;
}

export const GUN_CATALOG: Record<GunId, GunStats> = {
  sidearm: {
    id: 'sidearm', name: 'Standard Sidearm', tier: 1,
    damage: 12, fireRate: 180, accuracy: 0.80, projectileSpeed: 22, range: 8,
    critChance: 0.05, critMult: 1.5, magazine: 12, reloadTime: 1.6,
  },
  smg: {
    id: 'smg', name: 'Compact SMG', tier: 2,
    damage: 9, fireRate: 600, accuracy: 0.62, projectileSpeed: 26, range: 7,
    critChance: 0.05, critMult: 1.5, magazine: 30, reloadTime: 2.0,
  },
  assault_rifle: {
    id: 'assault_rifle', name: 'Assault Rifle', tier: 3,
    damage: 18, fireRate: 360, accuracy: 0.72, projectileSpeed: 30, range: 10,
    critChance: 0.08, critMult: 1.6, magazine: 24, reloadTime: 2.2,
  },
  marksman: {
    id: 'marksman', name: 'Marksman Rifle', tier: 4,
    damage: 45, fireRate: 90, accuracy: 0.90, projectileSpeed: 40, range: 14,
    critChance: 0.15, critMult: 2.0, magazine: 8, reloadTime: 2.4,
  },
  legendary: {
    id: 'legendary', name: 'Valor Prototype', tier: 5,
    damage: 30, fireRate: 480, accuracy: 0.80, projectileSpeed: 34, range: 12,
    critChance: 0.12, critMult: 1.8, magazine: 28, reloadTime: 1.8,
  },
};

/** The free starter gun every player owns. */
export const STARTER_GUN_ID: GunId = 'sidearm';

export function getGun(id: GunId): GunStats {
  return GUN_CATALOG[id];
}
