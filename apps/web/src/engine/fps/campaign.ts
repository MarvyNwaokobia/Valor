/**
 * @module fps/campaign
 * @description The mission campaign (the plan slice 4→8). The engine runs ONE
 * mission's data at a time; this file is that data, as a list, grouped by zone.
 *
 * A Mission is pure data — compound geometry, enemy roster, objective sequence,
 * briefing, starting weapon. The scene loads `CAMPAIGN[i]`, completing a mission
 * advances to the next, and each zone ends on a boss. Zones also carry a visual
 * theme (lighting / fog / tint) so Ashfall, the Proving Ground and the Rift read
 * as different places.
 */

import type { CoverBox, EnemySpec } from './index';
import type { GunId } from '../combat/GunStats';

export interface Objective {
  text: string;
  kind: 'reach' | 'clear';
  pos: [number, number];
  room?: number;
  activateRoom?: number;
}

export interface Mission {
  id: string;
  zone: string;   // ASHFALL / PROVING GROUND / THE RIFT
  op: string;     // briefing header, e.g. "OPERATION ASHFALL"
  name: string;   // mission title, e.g. "BREACH & CLEAR"
  brief: string;  // one-line briefing subtitle
  gun: GunId;         // primary weapon for the op
  secondary?: GunId;  // sidearm slot (defaults to the pistol) — swap with the swap key
  start: [number, number];
  walls: CoverBox[];
  cover: CoverBox[];
  enemies: EnemySpec[];
  objectives: Objective[];
  boss?: boolean;
}

/** Per-zone look. Lighting is in physical units (single digits for point lights). */
export interface ZoneTheme {
  bg: string;
  fog: [string, number, number];
  hemi: [string, string, number];
  sun: { color: string; intensity: number };
  fill: { color: string; intensity: number };
  ambient: number;
  practical: string;
  practicalIntensity: number;
  floorTint: string;
  wallTint: string;
}

export const ZONE_THEMES: Record<string, ZoneTheme> = {
  // Grounded, burned, warm dusk.
  ASHFALL: {
    bg: '#0b0d10', fog: ['#13161b', 14, 48], hemi: ['#8ea3b8', '#2b241d', 0.45],
    sun: { color: '#ffeede', intensity: 1.1 }, fill: { color: '#6b86ad', intensity: 0.22 },
    ambient: 0.18, practical: '#ffd0a0', practicalIntensity: 2.0, floorTint: '#8f877c', wallTint: '#8a7f74',
  },
  // Colder, cleaner, institutional — a training compound.
  'PROVING GROUND': {
    bg: '#0a0e12', fog: ['#0e141a', 16, 54], hemi: ['#a3b8cc', '#20262c', 0.5],
    sun: { color: '#e6f0ff', intensity: 1.15 }, fill: { color: '#5578a0', intensity: 0.3 },
    ambient: 0.2, practical: '#8fc8e6', practicalIntensity: 2.2, floorTint: '#828892', wallTint: '#7c828c',
  },
  // The dark place: near-black, a cold violet wash — the NVG world.
  'THE RIFT': {
    bg: '#04060a', fog: ['#060a12', 9, 32], hemi: ['#3a4e6a', '#0a0e16', 0.22],
    sun: { color: '#5f7fb0', intensity: 0.45 }, fill: { color: '#7a55ff', intensity: 0.35 },
    ambient: 0.07, practical: '#9a6bff', practicalIntensity: 1.5, floorTint: '#4a4a58', wallTint: '#43454f',
  },
};

const WALL_H = 3.4;

/** The 5-beat doorkicker objective sequence for a two-room compound. */
function twoRoom(o: { breach: [number, number]; push: [number, number]; extract: [number, number]; clear2?: string }): Objective[] {
  return [
    { text: 'BREACH THE COMPOUND', kind: 'reach', pos: o.breach, activateRoom: 1 },
    { text: 'CLEAR THE FRONT ROOM', kind: 'clear', room: 1, pos: [o.breach[0], o.breach[1] - 4] },
    { text: 'PUSH TO THE OBJECTIVE', kind: 'reach', pos: o.push, activateRoom: 2 },
    { text: o.clear2 ?? 'CLEAR THE OBJECTIVE ROOM', kind: 'clear', room: 2, pos: [o.push[0], o.push[1] - 4] },
    { text: 'EXTRACT', kind: 'reach', pos: o.extract },
  ];
}

// ── LAYOUT A · the Ashfall compound (entry → front room → objective room) ──
const A_START: [number, number] = [0, 16];
const A_WALLS: CoverBox[] = [
  { x: -10, z: 0, w: 0.6, d: 37, h: WALL_H }, { x: 10, z: 0, w: 0.6, d: 37, h: WALL_H },
  { x: 0, z: 18.2, w: 20.6, d: 0.6, h: WALL_H },
  { x: -5.8, z: 8, w: 8.4, d: 0.6, h: WALL_H }, { x: 5.8, z: 8, w: 8.4, d: 0.6, h: WALL_H },
  { x: -3.75, z: 0, w: 12.5, d: 0.6, h: WALL_H }, { x: 7.75, z: 0, w: 4.5, d: 0.6, h: WALL_H },
  { x: -7.25, z: -8, w: 5.5, d: 0.6, h: WALL_H }, { x: 4.25, z: -8, w: 11.5, d: 0.6, h: WALL_H },
];
const A_COVER: CoverBox[] = [
  { x: 0, z: 12, w: 1.6, d: 1.6, h: 1.2 }, { x: -4, z: 5, w: 1.4, d: 1.4, h: 1.3 },
  { x: 3.5, z: 3.5, w: 2.0, d: 1.0, h: 1.35 }, { x: -2, z: 1.5, w: 1.2, d: 1.2, h: 1.2 },
  { x: -4, z: -3, w: 1.4, d: 1.4, h: 1.4 }, { x: 4, z: -6, w: 2.2, d: 1.0, h: 1.35 },
  { x: -6, z: -5.5, w: 1.0, d: 2.4, h: 1.5 }, { x: 2, z: -2, w: 1.4, d: 1.4, h: 1.2 },
];
const A_OBJ = { breach: [0, 8.5] as [number, number], push: [4, 0.5] as [number, number], extract: [-3, -14] as [number, number] };

// ── LAYOUT A2 · the Ashfall row-house (ash-2): same footprint, but the doors
//    zigzag the other way — left, then right, then centre — so it reads as a
//    different building even though the theme is identical. ──
const A2_START: [number, number] = [0, 16];
const A2_WALLS: CoverBox[] = [
  { x: -10, z: 0, w: 0.6, d: 37, h: WALL_H }, { x: 10, z: 0, w: 0.6, d: 37, h: WALL_H },
  { x: 0, z: 18.2, w: 20.6, d: 0.6, h: WALL_H },
  { x: -7.8, z: 9, w: 3.8, d: 0.6, h: WALL_H }, { x: 3.65, z: 9, w: 12.1, d: 0.6, h: WALL_H },  // door LEFT
  { x: -3.7, z: 1, w: 12, d: 0.6, h: WALL_H }, { x: 7.75, z: 1, w: 3.9, d: 0.6, h: WALL_H },     // door RIGHT
  { x: -5.8, z: -7, w: 8.4, d: 0.6, h: WALL_H }, { x: 5.8, z: -7, w: 8.4, d: 0.6, h: WALL_H },   // door CENTRE
];
const A2_COVER: CoverBox[] = [
  { x: 0, z: 6, w: 1.6, d: 1.6, h: 1.2 }, { x: -4, z: 3, w: 1.4, d: 1.4, h: 1.3 }, { x: 4, z: 4, w: 2.0, d: 1.0, h: 1.35 },
  { x: -3, z: -2, w: 1.4, d: 1.4, h: 1.4 }, { x: 4, z: -5, w: 2.2, d: 1.0, h: 1.35 }, { x: -6, z: -4, w: 1.0, d: 2.4, h: 1.5 }, { x: 1, z: -3, w: 1.4, d: 1.4, h: 1.2 },
];
const A2_OBJ = { breach: [-4, 8] as [number, number], push: [4, 0.3] as [number, number], extract: [0, -13] as [number, number] };

// ── LAYOUT A3 · the Ashfall stronghold (ash-3, Cinder): doors mirror A2 (right,
//    left, right) and funnel to a back room where Cinder holds. ──
const A3_START: [number, number] = [0, 16];
const A3_WALLS: CoverBox[] = [
  { x: -10, z: 0, w: 0.6, d: 37, h: WALL_H }, { x: 10, z: 0, w: 0.6, d: 37, h: WALL_H },
  { x: 0, z: 18.2, w: 20.6, d: 0.6, h: WALL_H },
  { x: -3.7, z: 9, w: 12, d: 0.6, h: WALL_H }, { x: 7.75, z: 9, w: 3.9, d: 0.6, h: WALL_H },     // door RIGHT
  { x: -7.75, z: 1, w: 3.9, d: 0.6, h: WALL_H }, { x: 3.7, z: 1, w: 12, d: 0.6, h: WALL_H },     // door LEFT
  { x: -3.7, z: -7, w: 12, d: 0.6, h: WALL_H }, { x: 7.75, z: -7, w: 3.9, d: 0.6, h: WALL_H },   // door RIGHT
];
const A3_COVER: CoverBox[] = [
  { x: 0, z: 6, w: 1.6, d: 1.6, h: 1.2 }, { x: 3, z: 3, w: 1.4, d: 1.4, h: 1.3 }, { x: -3, z: 4, w: 2.0, d: 1.0, h: 1.35 },
  { x: 4, z: -4, w: 1.0, d: 2.4, h: 1.5 }, { x: -4, z: -5, w: 1.6, d: 1.0, h: 1.35 }, { x: 1, z: -2, w: 1.4, d: 1.4, h: 1.2 },
];
const A3_OBJ = { breach: [4, 8] as [number, number], push: [-4, 0.3] as [number, number], extract: [4, -13] as [number, number] };

// ── LAYOUT B · a wider hall then a deep objective room; doorways offset the
//    other way, so it plays as a different building, not the same rooms. ──
const B_START: [number, number] = [0, 14];
const B_WALLS: CoverBox[] = [
  { x: -10, z: -1, w: 0.6, d: 35, h: WALL_H }, { x: 10, z: -1, w: 0.6, d: 35, h: WALL_H },
  { x: 0, z: 16.2, w: 20.6, d: 0.6, h: WALL_H },
  { x: -8, z: 6, w: 4, d: 0.6, h: WALL_H }, { x: 4, z: 6, w: 12, d: 0.6, h: WALL_H },     // divider @z6, door at x=-4
  { x: -3.5, z: -6, w: 13, d: 0.6, h: WALL_H }, { x: 8.5, z: -6, w: 3, d: 0.6, h: WALL_H }, // divider @z-6, door at x=5
];
const B_COVER: CoverBox[] = [
  { x: 2, z: 11, w: 1.6, d: 1.6, h: 1.2 }, { x: -3, z: 2, w: 1.4, d: 2.4, h: 1.4 },
  { x: 4, z: -1, w: 2.2, d: 1.0, h: 1.35 }, { x: -5, z: -2, w: 1.2, d: 1.2, h: 1.2 }, { x: 2, z: 3, w: 1.4, d: 1.4, h: 1.3 },
  { x: -3, z: -11, w: 1.6, d: 1.6, h: 1.4 }, { x: 4, z: -13, w: 1.0, d: 2.4, h: 1.5 }, { x: -6, z: -10, w: 1.4, d: 1.0, h: 1.3 },
];
const B_OBJ = { breach: [-4, 6.5] as [number, number], push: [5, -5.5] as [number, number], extract: [0, -15] as [number, number] };

// ── LAYOUT C · the Rift: tight, claustrophobic, a straight push through two
//    centred doorways into the room where Valor waits. ──
const C_START: [number, number] = [0, 12];
const C_WALLS: CoverBox[] = [
  { x: -9, z: -1, w: 0.6, d: 31, h: WALL_H }, { x: 9, z: -1, w: 0.6, d: 31, h: WALL_H },
  { x: 0, z: 14.2, w: 18.6, d: 0.6, h: WALL_H },
  { x: -5.5, z: 4, w: 7, d: 0.6, h: WALL_H }, { x: 5.5, z: 4, w: 7, d: 0.6, h: WALL_H },     // divider @z4, centre door
  { x: -5.5, z: -6, w: 7, d: 0.6, h: WALL_H }, { x: 5.5, z: -6, w: 7, d: 0.6, h: WALL_H },   // divider @z-6, centre door
];
const C_COVER: CoverBox[] = [
  { x: 0, z: 9, w: 1.6, d: 1.6, h: 1.2 },
  { x: -3, z: 0, w: 1.4, d: 1.4, h: 1.3 }, { x: 3, z: -1, w: 1.4, d: 1.0, h: 1.35 }, { x: 0, z: 2, w: 1.2, d: 1.2, h: 1.2 },
  { x: -3, z: -11, w: 1.6, d: 1.6, h: 1.4 }, { x: 3, z: -12, w: 1.4, d: 1.0, h: 1.3 }, { x: 0, z: -9, w: 1.2, d: 2.0, h: 1.5 },
];
const C_OBJ = { breach: [0, 4.5] as [number, number], push: [0, -5.5] as [number, number], extract: [0, -13] as [number, number] };

const AR = 'assault_rifle' as GunId;
const SMG = 'smg' as GunId;
const DMR = 'marksman' as GunId;
const PROTO = 'legendary' as GunId; // the "Valor Prototype" — the finale weapon

export const CAMPAIGN: Mission[] = [
  // ── Zone 1 · ASHFALL (layout A) ──
  {
    id: 'ash-1', zone: 'ASHFALL', op: 'OPERATION ASHFALL', name: 'BREACH & CLEAR', gun: AR,
    brief: 'push the compound · clear both rooms · reach extract',
    start: A_START, walls: A_WALLS, cover: A_COVER,
    enemies: [
      { pos: [-4, 4], room: 1 }, { pos: [4, 5], room: 1 }, { pos: [-1, 3], room: 1 }, { pos: [3.5, 2.5], room: 1 },
      { pos: [-5, -4], room: 2 }, { pos: [5, -5], room: 2 }, { pos: [0, -6], room: 2 }, { pos: [-3, -7], room: 2 }, { pos: [4, -2.5], room: 2 },
    ],
    objectives: twoRoom(A_OBJ),
  },
  {
    id: 'ash-2', zone: 'ASHFALL', op: 'OPERATION ASHFALL', name: 'HOLD THE LINE', gun: SMG,
    brief: 'more of them, dug in · clear the compound',
    start: A2_START, walls: A2_WALLS, cover: A2_COVER,
    enemies: [
      { pos: [-5, 6], room: 1 }, { pos: [5, 5], room: 1 }, { pos: [-2, 4], room: 1 }, { pos: [3, 6], room: 1 }, { pos: [0, 3], room: 1 },
      { pos: [-7, -2], room: 2 }, { pos: [6, -4], room: 2 }, { pos: [0, -5], room: 2 }, { pos: [-3, -6], room: 2 }, { pos: [4, -2], room: 2 }, { pos: [-1, -5], room: 2 }, { pos: [2, -6], room: 2 },
    ],
    objectives: twoRoom(A2_OBJ),
  },
  {
    id: 'ash-3', zone: 'ASHFALL', op: 'OPERATION ASHFALL', name: 'CINDER', gun: AR, boss: true,
    brief: 'the man who lit the fire is in that room · put him down',
    start: A3_START, walls: A3_WALLS, cover: A3_COVER,
    enemies: [
      { pos: [-4, 6], room: 1 }, { pos: [4, 5], room: 1 }, { pos: [-2, 3], room: 1 }, { pos: [3, 6], room: 1 },
      { pos: [0, -5], room: 2, hp: 420, boss: true }, { pos: [-5, -3], room: 2 }, { pos: [5, -4], room: 2 }, { pos: [3, -6.5], room: 2 },
    ],
    objectives: twoRoom({ ...A3_OBJ, clear2: 'ELIMINATE CINDER' }),
  },

  // ── Zone 2 · PROVING GROUND (layout B) ──
  {
    id: 'pg-1', zone: 'PROVING GROUND', op: 'OPERATION PROVING GROUND', name: 'THE HALL', gun: DMR, secondary: SMG,
    brief: 'his crew trained here · take the hall, then the vault',
    start: B_START, walls: B_WALLS, cover: B_COVER,
    enemies: [
      { pos: [-5, 4], room: 1 }, { pos: [5, 3], room: 1 }, { pos: [-2, 0], room: 1 }, { pos: [3, -2], room: 1 }, { pos: [0, 2], room: 1 },
      { pos: [-5, -10], room: 2 }, { pos: [5, -11], room: 2 }, { pos: [0, -13], room: 2 }, { pos: [-3, -15], room: 2 },
    ],
    objectives: twoRoom(B_OBJ),
  },
  {
    id: 'pg-2', zone: 'PROVING GROUND', op: 'OPERATION PROVING GROUND', name: 'THE WARDEN', gun: AR, boss: true,
    brief: 'the Warden runs this place · he will not step aside',
    start: B_START, walls: B_WALLS, cover: B_COVER,
    enemies: [
      { pos: [-5, 4], room: 1 }, { pos: [5, 3], room: 1 }, { pos: [-2, 1], room: 1 }, { pos: [2, -2], room: 1 }, { pos: [0, 3], room: 1 }, { pos: [-4, -3], room: 1 },
      { pos: [0, -13], room: 2, hp: 520, boss: true }, { pos: [-5, -10], room: 2 }, { pos: [5, -11], room: 2 }, { pos: [-3, -15], room: 2 }, { pos: [5, -14], room: 2 },
    ],
    objectives: twoRoom({ ...B_OBJ, clear2: 'ELIMINATE THE WARDEN' }),
  },

  // ── Zone 3 · THE RIFT (layout C) — the dark place, and where Valor waits ──
  {
    id: 'rift-1', zone: 'THE RIFT', op: 'OPERATION RIFT', name: 'INTO THE DARK', gun: SMG,
    brief: 'his channel goes quiet here · push through and find him',
    start: C_START, walls: C_WALLS, cover: C_COVER,
    enemies: [
      { pos: [-4, 2], room: 1 }, { pos: [4, 1], room: 1 }, { pos: [-1, 0], room: 1 }, { pos: [2, -3], room: 1 }, { pos: [-2, 3], room: 1 },
      { pos: [-5, -10], room: 2 }, { pos: [4, -11], room: 2 }, { pos: [0, -13], room: 2 }, { pos: [-2, -9], room: 2 },
    ],
    objectives: twoRoom(C_OBJ),
  },
  {
    id: 'rift-valor', zone: 'THE RIFT', op: 'OPERATION RIFT', name: 'VALOR', gun: PROTO, secondary: AR, boss: true,
    brief: 'the voice on your radio has a face · end it',
    start: C_START, walls: C_WALLS, cover: C_COVER,
    enemies: [
      { pos: [-4, 2], room: 1 }, { pos: [4, 1], room: 1 }, { pos: [-1, -1], room: 1 }, { pos: [2, -3], room: 1 },
      { pos: [0, -12], room: 2, hp: 900, boss: true }, { pos: [-5, -9], room: 2 }, { pos: [4, -11], room: 2 }, { pos: [-2, -14], room: 2 },
    ],
    objectives: twoRoom({ ...C_OBJ, clear2: 'KILL VALOR' }),
  },
];

export const CAMPAIGN_KEY = 'valor_mission';   // the op you're currently on
export const PROGRESS_KEY = 'valor_progress';  // the furthest op you've unlocked (soft gating)
