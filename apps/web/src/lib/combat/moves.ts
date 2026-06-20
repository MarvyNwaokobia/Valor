import type { MoveData } from './types'
import type { CharacterClass } from '@/lib/classes'

// ── Base move templates ──────────────────────────────────────────────────────
// Timings inspired by fighting game frame data:
// Light = fast startup, low damage, chains into combos
// Heavy = slow startup, high damage, ends combos
// Special = class-unique finisher

const LIGHT_ATTACK: MoveData = {
  id: 'light_attack',
  damage: 8,
  startupMs: 120,
  activeMs: 100,
  recoveryMs: 200,
  lungeDistance: 0.15,
  staggerMs: 250,
  animClip: 'attack',
  animSpeed: 1.8,
  comboFollowUps: ['light_attack', 'heavy_attack', 'special'],
  blockDamageMult: 0.15,
  staminaCost: 8,
  blockLockoutMs: 0,
}

const HEAVY_ATTACK: MoveData = {
  id: 'heavy_attack',
  damage: 18,
  startupMs: 350,
  activeMs: 150,
  recoveryMs: 400,
  lungeDistance: 0.3,
  staggerMs: 450,
  animClip: 'attack',
  animSpeed: 0.7,
  comboFollowUps: [],
  blockDamageMult: 0.25,
  staminaCost: 18,
  blockLockoutMs: 100,
}

const SPECIAL_BASE: MoveData = {
  id: 'special',
  damage: 30,
  startupMs: 280,
  activeMs: 200,
  recoveryMs: 500,
  lungeDistance: 0.35,
  staggerMs: 600,
  animClip: 'attack',
  animSpeed: 1.0,
  comboFollowUps: [],
  blockDamageMult: 0.4,
  staminaCost: 0,
  blockLockoutMs: 150,
}

// ── Class-specific move sets ─────────────────────────────────────────────────

const BERSERKER_MOVES: Record<string, MoveData> = {
  light_attack: {
    ...LIGHT_ATTACK,
    damage: 10,
    startupMs: 100,
    staggerMs: 200,
  },
  heavy_attack: {
    ...HEAVY_ATTACK,
    damage: 24,
    lungeDistance: 0.4,
    staggerMs: 550,
  },
  special: {
    ...SPECIAL_BASE,
    id: 'special',
    damage: 40,
    startupMs: 400,
    activeMs: 250,
    recoveryMs: 600,
    lungeDistance: 0.5,
    staggerMs: 800,
    animSpeed: 0.6,
  },
}

const SENTINEL_MOVES: Record<string, MoveData> = {
  light_attack: {
    ...LIGHT_ATTACK,
    damage: 7,
    startupMs: 140,
    recoveryMs: 180,
  },
  heavy_attack: {
    ...HEAVY_ATTACK,
    damage: 15,
    startupMs: 300,
    staggerMs: 500,
    blockDamageMult: 0.1,
  },
  special: {
    ...SPECIAL_BASE,
    id: 'special',
    damage: 12,
    startupMs: 200,
    activeMs: 400,
    recoveryMs: 300,
    lungeDistance: 0.1,
    staggerMs: 300,
    animSpeed: 0.8,
  },
}

const PHANTOM_MOVES: Record<string, MoveData> = {
  light_attack: {
    ...LIGHT_ATTACK,
    damage: 9,
    startupMs: 80,
    activeMs: 80,
    recoveryMs: 150,
    animSpeed: 2.2,
    staggerMs: 180,
  },
  heavy_attack: {
    ...HEAVY_ATTACK,
    damage: 16,
    startupMs: 250,
    recoveryMs: 350,
    lungeDistance: 0.35,
  },
  special: {
    ...SPECIAL_BASE,
    id: 'special',
    damage: 28,
    startupMs: 150,
    activeMs: 150,
    recoveryMs: 400,
    lungeDistance: 0.45,
    staggerMs: 500,
    animSpeed: 1.6,
  },
}

const CLASS_MOVES: Record<CharacterClass, Record<string, MoveData>> = {
  Berserker: BERSERKER_MOVES,
  Sentinel: SENTINEL_MOVES,
  Phantom: PHANTOM_MOVES,
}

export function getMovesForClass(cls: CharacterClass): Record<string, MoveData> {
  return CLASS_MOVES[cls]
}

export function getMove(cls: CharacterClass, moveId: string): MoveData {
  return CLASS_MOVES[cls][moveId] ?? LIGHT_ATTACK
}

export function getMoveDuration(move: MoveData): number {
  return move.startupMs + move.activeMs + move.recoveryMs
}

export function isInStartup(move: MoveData, elapsed: number): boolean {
  return elapsed < move.startupMs
}

export function isInActiveFrames(move: MoveData, elapsed: number): boolean {
  return elapsed >= move.startupMs && elapsed < move.startupMs + move.activeMs
}

export function isInRecovery(move: MoveData, elapsed: number): boolean {
  const activeEnd = move.startupMs + move.activeMs
  return elapsed >= activeEnd && elapsed < activeEnd + move.recoveryMs
}

export function isInComboWindow(move: MoveData, elapsed: number): boolean {
  const activeEnd = move.startupMs + move.activeMs
  const comboStart = activeEnd + move.recoveryMs * 0.3
  const comboEnd = activeEnd + move.recoveryMs * 0.85
  return elapsed >= comboStart && elapsed < comboEnd && move.comboFollowUps.length > 0
}
