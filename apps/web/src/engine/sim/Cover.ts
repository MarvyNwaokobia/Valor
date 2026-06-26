/**
 * Arena cover — the obstacle layout that turns the stat-duel into a positional
 * gunfight. Lives in the sim (not the renderer) so collision + line-of-sight are
 * authoritative and headless-testable, exactly like the rest of CombatSim.
 *
 * Cover does two jobs:
 *   1. Blocks movement (fighters can't walk through it) — circle-vs-AABB push-out.
 *   2. Blocks line of sight (a shot through a piece is absorbed) — segment-vs-AABB.
 *
 * Pieces are axis-aligned boxes in the XZ plane, laid out symmetric about the
 * origin so neither fighter is advantaged in the 1v1. The layout is deliberately
 * OPEN — a single thin wall across the duel line (fighters spawn at ±2.5 on X) so
 * the opening shot is denied and you round its ends to get an angle, plus four
 * pillars pushed out to the corners for flank/retreat cover. The middle ring is
 * left clear so there's room to actually move ("peek, don't stand" without a cage).
 */
export interface CoverBox {
  x: number;
  z: number;
  hx: number; // half-extent on X
  hz: number; // half-extent on Z
  height: number; // top Y; a shot is blocked if it passes through the footprint
}

export const COVER: CoverBox[] = [
  // Thin wall across the duel line — round its ends (move in Z) to open a sightline.
  { x: 0, z: 0, hx: 0.7, hz: 1.5, height: 1.5 },
  // Corner pillars, pushed out so the centre ring stays open to move through.
  { x: 3.9, z: 3.4, hx: 0.8, hz: 0.8, height: 1.25 },
  { x: -3.9, z: -3.4, hx: 0.8, hz: 0.8, height: 1.25 },
  { x: -3.9, z: 3.4, hx: 0.8, hz: 0.8, height: 1.25 },
  { x: 3.9, z: -3.4, hx: 0.8, hz: 0.8, height: 1.25 },
];

// Shots travel between muzzle (~1.4m) and torso (~1.05m); every piece is taller
// than that, so for v1 any box the sightline crosses in XZ blocks it.
const SHOT_HEIGHT = 1.05;

/**
 * Push a circle (a fighter) out of every cover box it overlaps. Returns the
 * corrected [x, z]. Handles the centre-inside case by ejecting along the
 * shallowest axis.
 */
export function resolveCover(px: number, pz: number, radius: number): [number, number] {
  for (const c of COVER) {
    const minX = c.x - c.hx, maxX = c.x + c.hx;
    const minZ = c.z - c.hz, maxZ = c.z + c.hz;
    const cx = Math.max(minX, Math.min(px, maxX));
    const cz = Math.max(minZ, Math.min(pz, maxZ));
    const dx = px - cx, dz = pz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;

    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = radius - d;
      px += (dx / d) * push;
      pz += (dz / d) * push;
    } else {
      // Centre is inside the box — eject along the nearest face.
      const toRight = maxX - px, toLeft = px - minX;
      const toFar = maxZ - pz, toNear = pz - minZ;
      const m = Math.min(toRight, toLeft, toFar, toNear);
      if (m === toRight) px = maxX + radius;
      else if (m === toLeft) px = minX - radius;
      else if (m === toFar) pz = maxZ + radius;
      else pz = minZ - radius;
    }
  }
  return [px, pz];
}

/**
 * Line-of-sight test in XZ. Returns the closest point where the segment a→b first
 * enters a cover box (where a blocked shot should spark), or null if the sightline
 * is clear. Slab method per box; tracks the nearest entry across all pieces.
 */
export function losHit(
  ax: number, az: number,
  bx: number, bz: number,
  shotHeight: number = SHOT_HEIGHT,
): { x: number; z: number } | null {
  const dx = bx - ax, dz = bz - az;
  let bestT = Infinity;
  let hit: { x: number; z: number } | null = null;

  for (const c of COVER) {
    if (c.height < shotHeight) continue; // too low to block this shot
    const minX = c.x - c.hx, maxX = c.x + c.hx;
    const minZ = c.z - c.hz, maxZ = c.z + c.hz;
    let t0 = 0, t1 = 1;

    if (Math.abs(dx) < 1e-9) {
      if (ax < minX || ax > maxX) continue;
    } else {
      let ta = (minX - ax) / dx, tb = (maxX - ax) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (Math.abs(dz) < 1e-9) {
      if (az < minZ || az > maxZ) continue;
    } else {
      let ta = (minZ - az) / dz, tb = (maxZ - az) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }

    if (t0 <= t1 && t1 >= 0 && t0 <= 1 && t0 < bestT) {
      bestT = t0;
      hit = { x: ax + dx * t0, z: az + dz * t0 };
    }
  }
  return hit;
}
