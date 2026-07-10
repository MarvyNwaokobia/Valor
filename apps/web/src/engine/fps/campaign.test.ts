import { describe, it, expect } from 'vitest';
import { CAMPAIGN, ZONE_THEMES, SURVIVAL_MISSION, survivalWaveCount, survivalWaveHp } from './campaign';
import type { CoverBox } from './index';

// A spawned enemy / a standing objective marker must not overlap a wall or a
// cover block. 0.3 ≈ an enemy's body radius, so this flags a spawn that clips
// into geometry while still allowing enemies to hug cover.
const CLEAR = 0.3;

function inside(px: number, pz: number, b: CoverBox, margin: number): boolean {
  return Math.abs(px - b.x) < b.w / 2 + margin && Math.abs(pz - b.z) < b.d / 2 + margin;
}

describe('campaign geometry', () => {
  it('has 7 missions across 3 themed zones', () => {
    expect(CAMPAIGN).toHaveLength(7);
    const zones = new Set(CAMPAIGN.map((m) => m.zone));
    expect(zones).toEqual(new Set(['ASHFALL', 'PROVING GROUND', 'THE RIFT']));
    for (const z of zones) expect(ZONE_THEMES[z]).toBeDefined();
  });

  for (const m of CAMPAIGN) {
    describe(`${m.id} (${m.zone})`, () => {
      const solids = [...m.walls, ...m.cover];

      it('spawns no enemy inside a wall or cover block', () => {
        for (const e of m.enemies) {
          const hit = solids.find((b) => inside(e.pos[0], e.pos[1], b, CLEAR));
          expect(hit, `enemy at [${e.pos}] overlaps box @[${hit?.x},${hit?.z}]`).toBeUndefined();
        }
      });

      it('keeps every objective marker on standable floor (walls only)', () => {
        for (const o of m.objectives) {
          const hit = m.walls.find((b) => inside(o.pos[0], o.pos[1], b, CLEAR));
          expect(hit, `objective "${o.text}" at [${o.pos}] is inside a wall`).toBeUndefined();
        }
      });

      it('starts the player in the open', () => {
        expect(solids.find((b) => inside(m.start[0], m.start[1], b, CLEAR))).toBeUndefined();
      });

      it('tags exactly one boss iff it is a boss op', () => {
        const bosses = m.enemies.filter((e) => e.boss);
        expect(bosses).toHaveLength(m.boss ? 1 : 0);
      });

      it('routes objectives through the doorkicker sequence', () => {
        // reach → clear(room1) → reach → clear(room2) → reach
        expect(m.objectives.map((o) => o.kind)).toEqual(['reach', 'clear', 'reach', 'clear', 'reach']);
        expect(m.enemies.some((e) => e.room === 1)).toBe(true);
        expect(m.enemies.some((e) => e.room === 2)).toBe(true);
      });
    });
  }
});

describe('survival mode', () => {
  it('escalates in size and toughness, capped at the pool', () => {
    expect(survivalWaveCount(1)).toBeLessThan(survivalWaveCount(5));
    expect(survivalWaveCount(100)).toBeLessThanOrEqual(10);
    expect(survivalWaveHp(1)).toBe(1);
    expect(survivalWaveHp(6)).toBeGreaterThan(survivalWaveHp(1));
  });

  it('is a themed arena with a full pool and no objectives', () => {
    expect(SURVIVAL_MISSION.survival).toBe(true);
    expect(ZONE_THEMES[SURVIVAL_MISSION.zone]).toBeDefined();
    expect(SURVIVAL_MISSION.enemies.length).toBe(10);
    expect(SURVIVAL_MISSION.objectives).toEqual([]);
  });

  it('places no spawn or the player start inside a wall or cover', () => {
    const solids = [...SURVIVAL_MISSION.walls, ...SURVIVAL_MISSION.cover];
    expect(solids.find((b) => inside(SURVIVAL_MISSION.start[0], SURVIVAL_MISSION.start[1], b, CLEAR))).toBeUndefined();
    for (const e of SURVIVAL_MISSION.enemies) {
      const hit = solids.find((b) => inside(e.pos[0], e.pos[1], b, CLEAR));
      expect(hit, `survival spawn [${e.pos}] overlaps a box`).toBeUndefined();
    }
  });
});
