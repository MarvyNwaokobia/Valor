import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { AnimationStateMachine, AnimState, CLASS_ANIMATIONS, CLIP_NAMES } from '@/engine/animation'

// Verifies the combo-clip chain gating: a STANDALONE attack always plays the base
// clip (so single-tapping Light reads as one consistent move), and only a CANCEL
// advances through the variety pool (jab → cross → hook → kick inside a combo).

function makeMachine() {
  // Dummy clips named like the real ones; the machine selects by name.
  const names = [
    CLIP_NAMES.fightIdle, CLIP_NAMES.fistFight, CLIP_NAMES.jabCross,
    CLIP_NAMES.hookPunch, CLIP_NAMES.roundhouseKick,
  ]
  const clips = names.map((n) => new THREE.AnimationClip(n, 1, []))
  const mixer = new THREE.AnimationMixer(new THREE.Object3D())
  const asm = new AnimationStateMachine(CLASS_ANIMATIONS.berserker)
  asm.init(mixer, clips) // berserker Light pool: [fistFight, jabCross, hookPunch, roundhouseKick]
  return asm
}

describe('combo-clip chain gating', () => {
  it('standalone Light always plays the base clip', () => {
    const asm = makeMachine()
    for (let i = 0; i < 5; i++) {
      asm.transition(AnimState.Idle, true)
      asm.transition(AnimState.LightAttack, true, undefined, false) // fresh press (not a cancel)
      expect(asm.currentClipName).toBe(CLIP_NAMES.fistFight)
    }
  })

  it('a cancel chain advances through the variety pool', () => {
    const asm = makeMachine()
    asm.transition(AnimState.LightAttack, true, undefined, false) // fresh → base
    expect(asm.currentClipName).toBe(CLIP_NAMES.fistFight)
    asm.transition(AnimState.LightAttack, true, undefined, true)  // cancel → next
    expect(asm.currentClipName).toBe(CLIP_NAMES.jabCross)
    asm.transition(AnimState.LightAttack, true, undefined, true)  // cancel → next
    expect(asm.currentClipName).toBe(CLIP_NAMES.hookPunch)
  })

  it('a fresh press after a chain resets back to the base clip', () => {
    const asm = makeMachine()
    asm.transition(AnimState.LightAttack, true, undefined, false)
    asm.transition(AnimState.LightAttack, true, undefined, true) // → jabCross
    expect(asm.currentClipName).toBe(CLIP_NAMES.jabCross)
    asm.transition(AnimState.Idle, true)
    asm.transition(AnimState.LightAttack, true, undefined, false) // fresh again → base
    expect(asm.currentClipName).toBe(CLIP_NAMES.fistFight)
  })

  it('attack playback speeds are tuned down so clips breathe (Light ≈ 1.0)', () => {
    // Guards against re-introducing the rushed 1.3–1.5× multipliers.
    expect(CLASS_ANIMATIONS.berserker[AnimState.LightAttack]!.speed).toBeLessThanOrEqual(1.05)
    expect(CLASS_ANIMATIONS.phantom[AnimState.LightAttack]!.speed).toBeLessThanOrEqual(1.2)
    expect(CLASS_ANIMATIONS.sentinel[AnimState.LightAttack]!.speed).toBeLessThanOrEqual(1.05)
  })
})
