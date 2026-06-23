import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as THREE from 'three'
import { EnemyAI, AIDifficulty } from '@/engine/combat/EnemyAI'
import { CharacterController } from '@/engine/character/CharacterController'
import { Action } from '@/engine/input/InputSystem'

// Drive the AI through many frames with the player parked in attack range, and
// record each attack it throws plus how long a combo string it queued behind it.
// Positions are held fixed (we don't step the controllers), so the AI just keeps
// cycling Idle → Telegraph → Attack and we can sample lots of attacks.
function runAI(difficulty: AIDifficulty, frames: number) {
  const ai = new EnemyAI(difficulty)
  const self = new CharacterController(new THREE.Vector3(0, 0, 0))
  const player = new CharacterController(new THREE.Vector3(1.4, 0, 0)) // inside every attackRange
  const vin = ai.getInput()
  const ATTACKS = [Action.LightAttack, Action.HeavyAttack, Action.Special]

  let attacks = 0
  let chained = 0
  let maxString = 0
  let prevHeld = false
  const dt = 1 / 60

  for (let i = 0; i < frames; i++) {
    ai.update(dt, self, player)
    const held = ATTACKS.some((a) => vin.getAction(a).held)
    if (held && !prevHeld) {
      attacks++
      // Drain the follow-up string queued for this attack (the scene would pull
      // these one-per-cancel-window during the swing).
      let len = 1 // the initial hit
      while (ai.takeFollowUp() !== null) len++
      if (len > 1) chained++
      if (len > maxString) maxString = len
    }
    prevHeld = held
  }
  return { attacks, chained, maxString }
}

describe('EnemyAI combo chaining', () => {
  // Deterministic RNG so the FSM + chain rolls are reproducible.
  beforeEach(() => {
    let seed = 0x9e3779b9
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0x100000000
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('throws attacks and queues multi-hit strings on a high-combo difficulty', () => {
    const { attacks, chained, maxString } = runAI(AIDifficulty.Boss, 4000)
    expect(attacks).toBeGreaterThan(10)        // it actually attacks
    expect(chained).toBeGreaterThan(0)         // and chains some of them
    expect(maxString).toBeGreaterThanOrEqual(2) // strings are 2+ hits
    expect(maxString).toBeLessThanOrEqual(3)    // capped at first + 2 follow-ups
  })

  it('chains far less on a low-combo difficulty (comboChance scales with skill)', () => {
    const boss = runAI(AIDifficulty.Boss, 4000)
    const easy = runAI(AIDifficulty.Easy, 4000)
    const bossRate = boss.chained / boss.attacks
    const easyRate = easy.chained / easy.attacks
    expect(easyRate).toBeLessThan(bossRate)
  })

  it('takeFollowUp drains to null when there is no pending string', () => {
    const ai = new EnemyAI(AIDifficulty.Easy)
    // No attack chosen yet → nothing queued.
    expect(ai.takeFollowUp()).toBeNull()
  })
})
