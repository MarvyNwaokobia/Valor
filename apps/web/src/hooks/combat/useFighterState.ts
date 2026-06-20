import type { Fighter, FighterState, FighterSide, MoveData, CombatAction } from '@/lib/combat/types'
import type { CharacterClass } from '@/lib/classes'
import { getMove, getMoveDuration, isInComboWindow } from '@/lib/combat/moves'
import {
  MAX_HP, MAX_STAMINA, STAMINA_REGEN_PER_SEC, STAMINA_REGEN_BLOCKING,
  DODGE_STAMINA_COST, DODGE_DURATION_MS, DODGE_IFRAMES_MS,
  BLOCK_STAMINA_COST, GUARD_BREAK_THRESHOLD, GUARD_BREAK_STUN_MS,
  PLAYER_BASE_X, BOT_BASE_X,
  SPECIAL_METER_PER_DMG_DEALT, SPECIAL_METER_PER_DMG_TAKEN, SPECIAL_METER_THRESHOLD,
  COMBO_DAMAGE_BASE, COMBO_DAMAGE_INCREMENT, COMBO_DAMAGE_CAP,
  KNOCKBACK_LIGHT, KNOCKBACK_HEAVY, KNOCKBACK_SPECIAL, DODGE_TRAVEL,
} from '@/lib/combat/constants'

export function createFighter(
  side: FighterSide,
  characterClass: CharacterClass,
): Fighter {
  const baseX = side === 'player' ? PLAYER_BASE_X : BOT_BASE_X
  return {
    side,
    characterClass,
    hp: MAX_HP,
    maxHp: MAX_HP,
    stamina: MAX_STAMINA,
    maxStamina: MAX_STAMINA,
    state: 'idle',
    stateStartedAt: 0,
    currentMove: null,
    hitConnected: false,
    positionX: baseX,
    basePositionX: baseX,
    facing: side === 'player' ? 1 : -1,
    comboCount: 0,
    comboWindowMs: 0,
    specialUsed: false,
    specialMeter: 0,
    invincible: false,
    guardCount: 0,
  }
}

function canAct(fighter: Fighter): boolean {
  return fighter.state === 'idle' || fighter.state === 'blocking'
}

function isAttacking(state: FighterState): boolean {
  return state === 'light_attack' || state === 'heavy_attack' || state === 'special'
}

function stateElapsed(fighter: Fighter, now: number): number {
  return now - fighter.stateStartedAt
}

export function applyAction(
  fighter: Fighter,
  action: CombatAction,
  now: number,
): Fighter {
  const f = { ...fighter }

  if (action === 'block_start' && canAct(f)) {
    f.state = 'blocking'
    f.stateStartedAt = now
    f.currentMove = null
    return f
  }

  if (action === 'block_end' && f.state === 'blocking') {
    f.state = 'idle'
    f.stateStartedAt = now
    f.guardCount = 0
    return f
  }

  if (action === 'dodge' && canAct(f) && f.stamina >= DODGE_STAMINA_COST) {
    f.state = 'dodging'
    f.stateStartedAt = now
    f.stamina -= DODGE_STAMINA_COST
    f.invincible = true
    f.currentMove = null
    f.comboCount = 0
    return f
  }

  if (action === 'special' && canAct(f) && !f.specialUsed && f.specialMeter >= SPECIAL_METER_THRESHOLD) {
    const move = getMove(f.characterClass, 'special')
    f.state = 'special'
    f.stateStartedAt = now
    f.currentMove = move
    f.hitConnected = false
    f.specialUsed = true
    f.specialMeter = 0
    return f
  }

  if (action === 'light_attack' || action === 'heavy_attack') {
    const moveId = action
    const move = getMove(f.characterClass, moveId)

    if (isAttacking(f.state) && f.currentMove) {
      const elapsed = stateElapsed(f, now)
      if (isInComboWindow(f.currentMove, elapsed) && f.currentMove.comboFollowUps.includes(moveId)) {
        f.state = moveId as FighterState
        f.stateStartedAt = now
        f.currentMove = move
        f.hitConnected = false
        f.stamina = Math.max(0, f.stamina - move.staminaCost)
        return f
      }
      return f
    }

    if (canAct(f) && f.stamina >= move.staminaCost) {
      f.state = moveId as FighterState
      f.stateStartedAt = now
      f.currentMove = move
      f.hitConnected = false
      f.stamina -= move.staminaCost
      if (f.state !== 'blocking') f.guardCount = 0
      return f
    }
  }

  return f
}

export interface HitResult {
  damage: number
  blocked: boolean
  guardBroken: boolean
}

export function resolveHit(
  attacker: Fighter,
  defender: Fighter,
  move: MoveData,
): HitResult {
  if (defender.invincible) return { damage: 0, blocked: false, guardBroken: false }

  const comboMult = Math.min(
    COMBO_DAMAGE_CAP,
    COMBO_DAMAGE_BASE + attacker.comboCount * COMBO_DAMAGE_INCREMENT,
  )

  if (defender.state === 'blocking' && defender.stamina > 0) {
    const chipDamage = Math.max(1, Math.round(move.damage * move.blockDamageMult * comboMult))
    const newGuardCount = defender.guardCount + 1
    const guardBroken = newGuardCount >= GUARD_BREAK_THRESHOLD
    return { damage: chipDamage, blocked: true, guardBroken }
  }

  const rawDamage = Math.round(move.damage * comboMult)
  return { damage: rawDamage, blocked: false, guardBroken: false }
}

export function applyHitToDefender(
  defender: Fighter,
  hit: HitResult,
  _staggerMs: number,
  now: number,
  moveId?: string,
): Fighter {
  const d = { ...defender }
  d.hp = Math.max(0, d.hp - hit.damage)
  d.specialMeter = Math.min(100, d.specialMeter + hit.damage * SPECIAL_METER_PER_DMG_TAKEN)

  // Knockback — push defender away from attacker
  if (hit.damage > 0 && !d.invincible) {
    const kb = moveId === 'special' ? KNOCKBACK_SPECIAL
      : moveId === 'heavy_attack' ? KNOCKBACK_HEAVY
      : KNOCKBACK_LIGHT
    const kbDir = -d.facing // push away from attacker
    d.positionX += kbDir * (hit.blocked ? kb * 0.4 : kb)
    d.basePositionX += kbDir * (hit.blocked ? kb * 0.3 : kb * 0.6)
    // Clamp to arena bounds
    d.basePositionX = Math.max(-2.2, Math.min(2.2, d.basePositionX))
    d.positionX = Math.max(-2.2, Math.min(2.2, d.positionX))
  }

  if (d.hp <= 0) {
    d.state = 'dead'
    d.stateStartedAt = now
    d.currentMove = null
    return d
  }

  if (hit.guardBroken) {
    d.state = 'hit_stun'
    d.stateStartedAt = now
    d.currentMove = null
    d.guardCount = 0
    d.stamina = 0
    return d
  }

  if (hit.blocked) {
    d.stamina = Math.max(0, d.stamina - BLOCK_STAMINA_COST)
    d.guardCount += 1
    return d
  }

  d.state = 'hit_stun'
  d.stateStartedAt = now
  d.currentMove = null
  d.comboCount = 0
  return d
}

export function applyHitToAttacker(attacker: Fighter, hit: HitResult): Fighter {
  const a = { ...attacker }
  a.hitConnected = true
  if (!hit.blocked) {
    a.comboCount += 1
    a.specialMeter = Math.min(100, a.specialMeter + hit.damage * SPECIAL_METER_PER_DMG_DEALT)
  }
  return a
}

export function tickFighter(fighter: Fighter, now: number, deltaMs: number): Fighter {
  const f = { ...fighter }
  const elapsed = stateElapsed(f, now)

  if (f.state === 'dead') return f

  // Stamina regen
  const regenRate = f.state === 'blocking' ? STAMINA_REGEN_BLOCKING : STAMINA_REGEN_PER_SEC
  if (f.state === 'idle' || f.state === 'blocking') {
    f.stamina = Math.min(f.maxStamina, f.stamina + regenRate * (deltaMs / 1000))
  }

  // Dodge expires
  if (f.state === 'dodging') {
    if (elapsed >= DODGE_IFRAMES_MS) f.invincible = false
    if (elapsed >= DODGE_DURATION_MS) {
      f.state = 'idle'
      f.stateStartedAt = now
      f.invincible = false
    }
  }

  // Attack expires
  if (isAttacking(f.state) && f.currentMove) {
    const totalMs = getMoveDuration(f.currentMove)
    if (elapsed >= totalMs) {
      f.state = 'idle'
      f.stateStartedAt = now
      f.currentMove = null
    }
  }

  // Hit stun expires
  if (f.state === 'hit_stun') {
    const stunDuration = f.guardCount >= GUARD_BREAK_THRESHOLD
      ? GUARD_BREAK_STUN_MS
      : 350
    if (elapsed >= stunDuration) {
      f.state = 'idle'
      f.stateStartedAt = now
    }
  }

  // Position lerp back to base when idle
  if (f.state === 'idle' || f.state === 'blocking') {
    const lerpSpeed = 0.08
    f.positionX += (f.basePositionX - f.positionX) * lerpSpeed
  }

  // Lunge during attack startup/active
  if (isAttacking(f.state) && f.currentMove) {
    const lungeTarget = f.basePositionX + f.facing * f.currentMove.lungeDistance
    const attackProgress = Math.min(1, elapsed / (f.currentMove.startupMs + f.currentMove.activeMs))
    const lungeCurve = attackProgress < 0.5
      ? attackProgress * 2
      : 2 - attackProgress * 2
    f.positionX = f.basePositionX + (lungeTarget - f.basePositionX) * lungeCurve
  }

  // Dodge movement
  if (f.state === 'dodging') {
    const dodgeProgress = Math.min(1, elapsed / DODGE_DURATION_MS)
    const dodgeCurve = Math.sin(dodgeProgress * Math.PI)
    f.positionX = f.basePositionX - f.facing * DODGE_TRAVEL * dodgeCurve
  }

  return f
}

export function getFighterAnim(fighter: Fighter): { clip: string; speed: number } {
  switch (fighter.state) {
    case 'dead':
      return { clip: 'death', speed: 1.0 }
    case 'hit_stun':
      return { clip: 'hit', speed: 1.0 }
    case 'light_attack':
    case 'heavy_attack':
    case 'special':
      return {
        clip: fighter.currentMove?.animClip ?? 'attack',
        speed: fighter.currentMove?.animSpeed ?? 1.0,
      }
    case 'dodging':
      return { clip: 'dodge', speed: 1.2 }
    case 'blocking':
      return { clip: 'block', speed: 0.5 }
    default:
      return { clip: 'idle', speed: 1.0 }
  }
}
