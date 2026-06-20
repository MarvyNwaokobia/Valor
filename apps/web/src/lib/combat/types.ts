import type { CharacterClass } from '@/lib/classes'

// ── Fighter state machine ────────────────────────────────────────────────────

export type FighterState =
  | 'idle'
  | 'light_attack'
  | 'heavy_attack'
  | 'blocking'
  | 'dodging'
  | 'hit_stun'
  | 'special'
  | 'dead'

export type FighterSide = 'player' | 'bot'

// ── Move definitions ─────────────────────────────────────────────────────────

export interface MoveData {
  id: string
  damage: number
  /** Wind-up before the hit frame (ms) */
  startupMs: number
  /** Window where the hit can connect (ms) */
  activeMs: number
  /** Cooldown after the move ends (ms) */
  recoveryMs: number
  /** Lunge distance toward opponent (Three.js units) */
  lungeDistance: number
  /** How long the target is stunned on hit (ms) */
  staggerMs: number
  /** GLB animation clip to play */
  animClip: string
  /** Playback speed multiplier for the animation */
  animSpeed: number
  /** Moves that can chain after this one (combo) */
  comboFollowUps: string[]
  /** Chip damage when blocked (multiplier of full damage) */
  blockDamageMult: number
  /** Stamina cost */
  staminaCost: number
  /** Locks out blocking for this long after the move (ms) */
  blockLockoutMs: number
}

// ── Fighter runtime state ────────────────────────────────────────────────────

export interface Fighter {
  side: FighterSide
  characterClass: CharacterClass
  hp: number
  maxHp: number
  stamina: number
  maxStamina: number
  state: FighterState
  /** Timestamp when the current state started (performance.now) */
  stateStartedAt: number
  /** The move being executed (null when idle/blocking/dodging) */
  currentMove: MoveData | null
  /** Whether the active hit frame already connected this move */
  hitConnected: boolean
  /** Position on the X axis (Three.js units) */
  positionX: number
  /** Base position (rest position when idle) */
  basePositionX: number
  /** Facing direction: +1 = facing right, -1 = facing left */
  facing: number
  /** Combo counter — consecutive hits landed */
  comboCount: number
  /** Window to input next combo move (ms after recovery starts) */
  comboWindowMs: number
  /** Whether the special has been used this fight */
  specialUsed: boolean
  /** Special meter: fills on dealing/taking damage, 0-100 */
  specialMeter: number
  /** Invincibility frames active (dodge) */
  invincible: boolean
  /** Number of consecutive blocks (for guard break) */
  guardCount: number
}

// ── Combat engine state ──────────────────────────────────────────────────────

export type CombatPhase = 'intro' | 'fighting' | 'ko' | 'result'

export interface CombatState {
  phase: CombatPhase
  player: Fighter
  bot: Fighter
  /** Elapsed fight time in ms */
  elapsedMs: number
  /** Time-scale for slow-mo effects (1.0 = normal) */
  timeScale: number
  /** When slow-mo should end (performance.now) */
  slowMoUntil: number
  /** Total hits landed by player */
  playerHitsLanded: number
  /** Total hits landed by bot */
  botHitsLanded: number
  /** Highest combo achieved by player */
  maxCombo: number
  /** Whether the fight result has been submitted to API */
  resultSubmitted: boolean
}

// ── Input actions ────────────────────────────────────────────────────────────

export type CombatAction =
  | 'light_attack'
  | 'heavy_attack'
  | 'block_start'
  | 'block_end'
  | 'dodge'
  | 'special'

// ── Bot AI personality ───────────────────────────────────────────────────────

export type BotPersonality = 'aggressive' | 'defensive' | 'balanced' | 'adaptive'

export interface BotAIConfig {
  personality: BotPersonality
  /** Base reaction time in ms (how fast bot responds) */
  reactionMs: number
  /** Aggression: 0-1, higher = attacks more often */
  aggression: number
  /** How often bot blocks (0-1) */
  blockRate: number
  /** How often bot dodges (0-1) */
  dodgeRate: number
  /** Difficulty multiplier on damage dealt */
  damageMult: number
}

// ── Hit event (for VFX/audio) ────────────────────────────────────────────────

export interface HitEvent {
  attacker: FighterSide
  defender: FighterSide
  damage: number
  move: MoveData
  blocked: boolean
  comboCount: number
  isKO: boolean
  timestamp: number
}
