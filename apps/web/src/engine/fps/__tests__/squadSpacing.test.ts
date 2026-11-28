import { describe, it, expect } from 'vitest';
import { FpsSim, FPS_TUNING, type CoverBox, type FpsInput, type Vec3 } from '../FpsSim';
import { buildChain, entryCap, mulberry32 } from '../endless';

/**
 * Enemies know where each other are.
 *
 * Before this, an enemy's movement only ever considered the player and the walls.
 * A squad told to close on you, or to search the spot it last saw you, picked
 * goals around the same point and walked straight there — through each other — so
 * players saw two or three soldiers merge into one body as they advanced. These
 * pin the fix: bodies keep their distance, steer round each other and round you,
 * spread out over the room, and stop grinding into walls.
 */

const E = FPS_TUNING.ENEMY;
/** Two bodies closer than this are visibly inside each other (BODY_R each). */
const TOUCH = E.BODY_R * 2;

function inputAt(x: number, z: number): FpsInput {
  return {
    firing: false, wantReload: false,
    origin: [x, 1.6, z] as Vec3, dir: [0, 0, -1] as Vec3,
    adsFactor: 0, moving: false, crouched: false,
  };
}

function minPairGap(s: FpsSim): number {
  const live = s.getEnemies().filter((e) => e.alive);
  let min = Infinity;
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++)
      min = Math.min(min, Math.hypot(live[i].x - live[j].x, live[i].z - live[j].z));
  return min;
}

function insideGeometry(x: number, z: number, cover: readonly CoverBox[]): boolean {
  // A hair under BODY_R: slideMove stops a skin short of the face, never inside it.
  const r = E.BODY_R - 0.02;
  return cover.some((c) => Math.abs(x - c.x) < c.w / 2 + r && Math.abs(z - c.z) < c.d / 2 + r);
}

describe('squad spacing', () => {
  it('a squad spawned on top of itself separates and never merges again', () => {
    const s = new FpsSim({
      // Six bodies inside a 0.6m circle, two of them exactly coincident.
      enemies: [[0, -2], [0, -2], [0.3, -2.2], [-0.3, -1.8], [0.2, -1.7], [-0.2, -2.3]]
        .map((pos) => ({ pos: pos as [number, number] })),
      respawnEnabled: false,
      rng: mulberry32(7),
    });
    const input = inputAt(0, -14);
    // A pile this tight untangles over a few frames (each pass can push one body
    // into the next), well inside a tenth of a second.
    for (let i = 0; i < 6; i++) s.step(1 / 60, input);
    expect(minPairGap(s)).toBeGreaterThan(TOUCH);
    let worst = Infinity;
    for (let i = 0; i < 60 * 15; i++) {
      s.step(1 / 60, input);
      worst = Math.min(worst, minPairGap(s));
    }
    expect(worst).toBeGreaterThan(TOUCH);
  });

  it('nobody walks into the player while searching the spot they stand on', () => {
    // Player behind a wall: the squad hunts their last known position, which is
    // exactly where they still are.
    const wall: CoverBox = { x: 0, z: -8, w: 6, d: 0.6, h: 3 };
    const s = new FpsSim({
      enemies: [[-3, -14], [0, -15], [3, -14], [1.5, -16]].map((pos) => ({ pos: pos as [number, number] })),
      cover: [wall],
      respawnEnabled: false,
      rng: mulberry32(3),
    });
    // Let them see you first, then step behind the wall and hold still.
    for (let i = 0; i < 60; i++) s.step(1 / 60, inputAt(5, -6));
    let closest = Infinity;
    for (let i = 0; i < 60 * 5; i++) {
      s.step(1 / 60, inputAt(5, -6));
      for (const e of s.getEnemies()) closest = Math.min(closest, Math.hypot(e.x - 5, e.z + 6));
    }
    expect(closest).toBeGreaterThan(E.PLAYER_SPACING - 0.05);
  });

  it('a fight spreads round you instead of lining up on one side', () => {
    const s = new FpsSim({
      enemies: [[-1, -2], [0, -2], [1, -2], [-0.5, -3], [0.5, -3]].map((pos) => ({ pos: pos as [number, number] })),
      respawnEnabled: false,
      rng: mulberry32(11),
    });
    const input = inputAt(0, -14);
    for (let i = 0; i < 60 * 12; i++) s.step(1 / 60, input);
    const bearings = s.getEnemies().map((e) => Math.atan2(e.x - 0, e.z - -14));
    const spread = Math.max(...bearings) - Math.min(...bearings);
    // They all started dead ahead (inside ~0.15 rad of each other).
    expect(spread).toBeGreaterThan(0.9);
    // And their goals are distinct spots, not one shared coordinate.
    const goals = s.getEnemies().map((e) => [e.goalX, e.goalZ]);
    for (let i = 0; i < goals.length; i++)
      for (let j = i + 1; j < goals.length; j++)
        expect(Math.hypot(goals[i][0] - goals[j][0], goals[i][1] - goals[j][1])).toBeGreaterThan(1);
  });

  it('pinned against a wall, it gives up that goal instead of grinding into it', () => {
    // A long wall between it and the player's last-known spot.
    const wall: CoverBox = { x: 0, z: -6, w: 16, d: 0.6, h: 3 };
    const s = new FpsSim({ enemies: [{ pos: [0, -3] }], cover: [wall], respawnEnabled: false, rng: mulberry32(5) });
    const e = s.getEnemies()[0];
    // Force a hunt straight through the wall.
    e.seenAt = 0.001; e.seenX = 0; e.seenZ = -10; e.goalX = 0; e.goalZ = -10; e.nextGoalAt = 99;
    let repicked = false;
    for (let i = 0; i < 60 * 2; i++) {
      s.step(1 / 60, inputAt(0, -10));
      if (e.nextGoalAt < 99) { repicked = true; break; }
    }
    expect(repicked).toBe(true);
  });
});

describe('seasonal chain: a full run of crowded rooms', () => {
  it('no two enemies ever stand inside each other, and none ever enters a wall', () => {
    for (const seed of [1, 42, 9001]) {
      // Rooms 10–13: the late-season crowd (7–8 defenders a room).
      const rooms = buildChain(10, 4, 0, seed);
      const cover: CoverBox[] = [...entryCap(0)];
      for (const r of rooms) cover.push(...r.walls, ...r.cover);
      const s = new FpsSim({ enemies: [], cover, respawnEnabled: false, rng: mulberry32(seed) });
      s.setBounds(-ROOM_HALF, ROOM_HALF, rooms[rooms.length - 1].zFar, rooms[0].zNear);
      s.appendEnemies(rooms.flatMap((r) => r.enemies), true);

      // Walk down the middle of the chain over 40s while every room fights.
      const endZ = rooms[rooms.length - 1].zFar + 2;
      const steps = 60 * 40;
      let overlaps = 0, inWalls = 0;
      for (let i = 0; i < steps; i++) {
        const z = -1.5 + (endZ + 1.5) * (i / steps);
        s.step(1 / 60, inputAt(0, z));
        if (i < 30) continue; // let authored spawns settle
        if (minPairGap(s) < TOUCH) overlaps++;
        for (const e of s.getEnemies()) if (e.alive && insideGeometry(e.x, e.z, cover)) inWalls++;
      }
      expect(overlaps, `seed ${seed}: frames with merged bodies`).toBe(0);
      expect(inWalls, `seed ${seed}: enemy-frames inside geometry`).toBe(0);
    }
  });
});

const ROOM_HALF = 9;
