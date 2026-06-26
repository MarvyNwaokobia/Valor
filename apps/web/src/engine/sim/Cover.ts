/**
 * Arena cover — the obstacle layout that turns the stat-duel into a positional
 * gunfight. Lives in the sim (not the renderer) so collision + line-of-sight are
 * authoritative and headless-testable, exactly like the rest of CombatSim.
 *
 * Cover does two jobs:
 *   1. Blocks movement (fighters can't walk through it) — circle-vs-AABB push-out.
 *   2. Blocks line of sight (a shot through a piece is absorbed) — segment-vs-AABB.
 *
 * Layouts are procedurally generated with 180° rotational symmetry (so neither
 * fighter is advantaged) and vary in piece count, size, shape and height.
 */
export interface CoverBox {
  x: number;
  z: number;
  hx: number; // half-extent on X
  hz: number; // half-extent on Z
  height: number; // top Y; a shot is blocked if it passes through the footprint
}

// ── Seeded PRNG (splitmix32) so layouts are reproducible from a seed ──
function splitmix32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x9e3779b9 | 0;
    let t = seed ^ seed >>> 16; t = Math.imul(t, 0x21f0aaad);
    t = t ^ t >>> 15; t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ t >>> 15) >>> 0) / 4294967296;
  };
}

const ARENA_R = 7.5;
const SPAWN_X = 2.5;
const SPAWN_CLEAR = 1.8;   // no cover within this radius of a spawn point
const PIECE_MARGIN = 0.6;  // min gap between any two pieces
const ARENA_INSET = 1.0;   // keep pieces this far from the arena edge

interface PieceTemplate {
  hxRange: [number, number];
  hzRange: [number, number];
  heightRange: [number, number];
}

const TEMPLATES: PieceTemplate[] = [
  // Tall thin pillar
  { hxRange: [0.35, 0.55], hzRange: [0.35, 0.55], heightRange: [1.6, 2.2] },
  // Low wide wall (long on Z)
  { hxRange: [0.3, 0.5],   hzRange: [1.0, 1.8],   heightRange: [0.85, 1.1] },
  // Low wide wall (long on X)
  { hxRange: [1.0, 1.8],   hzRange: [0.3, 0.5],   heightRange: [0.85, 1.1] },
  // Medium barrier
  { hxRange: [0.5, 0.9],   hzRange: [0.5, 0.9],   heightRange: [1.2, 1.6] },
  // Tall narrow wall (long on Z)
  { hxRange: [0.25, 0.4],  hzRange: [1.2, 2.0],   heightRange: [1.4, 1.8] },
  // Tall narrow wall (long on X)
  { hxRange: [1.2, 2.0],   hzRange: [0.25, 0.4],  heightRange: [1.4, 1.8] },
  // Squat wide block
  { hxRange: [0.7, 1.2],   hzRange: [0.7, 1.2],   heightRange: [0.7, 1.0] },
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function boxesOverlap(a: CoverBox, b: CoverBox, margin: number): boolean {
  return Math.abs(a.x - b.x) < a.hx + b.hx + margin &&
         Math.abs(a.z - b.z) < a.hz + b.hz + margin;
}

function tooCloseToSpawn(box: CoverBox): boolean {
  for (const sx of [-SPAWN_X, SPAWN_X]) {
    const dx = box.x - sx, dz = box.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist - Math.max(box.hx, box.hz) < SPAWN_CLEAR) return true;
  }
  return false;
}

function outsideArena(box: CoverBox): boolean {
  const corners = [
    [box.x - box.hx, box.z - box.hz],
    [box.x + box.hx, box.z - box.hz],
    [box.x - box.hx, box.z + box.hz],
    [box.x + box.hx, box.z + box.hz],
  ];
  const rMax = ARENA_R - ARENA_INSET;
  return corners.some(([cx, cz]) => cx * cx + cz * cz > rMax * rMax);
}

function generateLayout(seed: number): CoverBox[] {
  const rand = splitmix32(seed);
  const pieces: CoverBox[] = [];

  // Optionally place a centre piece (~60% chance) — sits on the duel line.
  if (rand() < 0.6) {
    const t = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
    const box: CoverBox = {
      x: 0,
      z: 0,
      hx: lerp(t.hxRange[0], t.hxRange[1], rand()),
      hz: lerp(t.hzRange[0], t.hzRange[1], rand()),
      height: lerp(t.heightRange[0], t.heightRange[1], rand()),
    };
    if (!tooCloseToSpawn(box)) pieces.push(box);
  }

  // Place 4-7 symmetric pairs in the half-plane (x > 0, mirrored to -x, -z).
  const pairCount = 4 + Math.floor(rand() * 4);
  let attempts = 0;
  let placed = 0;

  while (placed < pairCount && attempts < 200) {
    attempts++;
    const t = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
    const hx = lerp(t.hxRange[0], t.hxRange[1], rand());
    const hz = lerp(t.hzRange[0], t.hzRange[1], rand());
    const height = lerp(t.heightRange[0], t.heightRange[1], rand());

    const angle = rand() * Math.PI * 2;
    const dist = 1.5 + rand() * (ARENA_R - ARENA_INSET - 2.0);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    const a: CoverBox = { x, z, hx, hz, height };
    const b: CoverBox = { x: -x, z: -z, hx, hz, height };

    if (outsideArena(a) || outsideArena(b)) continue;
    if (tooCloseToSpawn(a) || tooCloseToSpawn(b)) continue;

    let overlaps = false;
    for (const p of pieces) {
      if (boxesOverlap(a, p, PIECE_MARGIN) || boxesOverlap(b, p, PIECE_MARGIN)) {
        overlaps = true;
        break;
      }
    }
    // Also check the pair against each other (if they're near the origin).
    if (!overlaps && boxesOverlap(a, b, PIECE_MARGIN)) overlaps = true;
    if (overlaps) continue;

    pieces.push(a);
    // Don't double-add if the mirror is nearly the same piece (centre-ish).
    if (Math.abs(x) > 0.3 || Math.abs(z) > 0.3) pieces.push(b);
    placed++;
  }

  return pieces;
}

// ── Module-level layout — regenerated each match via regenerateCover() ──

export let COVER: CoverBox[] = generateLayout(Date.now());

export function regenerateCover(seed?: number): CoverBox[] {
  COVER = generateLayout(seed ?? Date.now());
  return COVER;
}

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
