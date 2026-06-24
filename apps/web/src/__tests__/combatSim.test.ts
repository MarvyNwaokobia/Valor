import { describe, it, expect } from 'vitest'
import { CombatSim, type FighterId } from '@/engine/sim/CombatSim'
import { InputSystem, Action } from '@/engine/input/InputSystem'
import { AIDifficulty } from '@/engine/combat'

// Proves the combat core runs fully headless — no Three rendering, no
// AnimationMixer, no WebGL/DOM — and resolves a real fight to a KO. This is the
// linchpin for server-authoritative PvP: the same sim can tick on a Node server.

describe('CombatSim (headless authoritative core)', () => {
  it('resolves a fight to a KO with an aggressor vs an idle fighter', () => {
    const sim = new CombatSim('berserker', 'phantom')
    const inA = new InputSystem()
    const inB = new InputSystem()
    const inputs: Record<FighterId, InputSystem> = { p1: inA, p2: inB }

    inA.setStick(1, 0) // p1 advances toward p2 (+x at cameraYaw 0)

    let hits = 0
    let sawKo = false
    for (let i = 0; i < 3600 && !sim.isOver; i++) {
      inA.triggerAction(Action.LightAttack) // re-buffer each tick so it keeps swinging
      const events = sim.step(1 / 60, inputs)
      for (const e of events) {
        if (e.kind === 'hit' && !e.event.blocked) hits++
        if (e.kind === 'ko') sawKo = true
      }
    }

    expect(sim.isOver).toBe(true)
    expect(sawKo).toBe(true)
    expect(sim.getWinner()).toBe('p1')

    const snap = sim.snapshot()
    expect(snap.fighters.p2.health).toBe(0)
    expect(snap.fighters.p2.isDead).toBe(true)
    expect(snap.fighters.p1.health).toBeGreaterThan(0)
    expect(hits).toBeGreaterThan(5) // it landed real hits along the way
  })

  it('produces serializable snapshots (StateUpdate-ready, no class instances leaking)', () => {
    const sim = new CombatSim('sentinel', 'berserker')
    const inputs: Record<FighterId, InputSystem> = { p1: new InputSystem(), p2: new InputSystem() }
    sim.step(1 / 60, inputs)

    const snap = sim.snapshot()
    // Round-trips through JSON cleanly → safe to send over the wire.
    const json = JSON.stringify(snap)
    const back = JSON.parse(json)
    expect(back.fighters.p1.position).toHaveLength(3)
    expect(back.fighters.p1.health).toBe(100)
    expect(typeof back.fighters.p1.animState).toBe('string')
    expect(back.winner).toBeNull()
  })

  it('does not award a winner while both fighters are idle', () => {
    const sim = new CombatSim('berserker', 'phantom')
    const inputs: Record<FighterId, InputSystem> = { p1: new InputSystem(), p2: new InputSystem() }
    for (let i = 0; i < 600; i++) sim.step(1 / 60, inputs)
    expect(sim.isOver).toBe(false)
    expect(sim.getWinner()).toBeNull()
  })

  it('runs PvE through the sim: AI opponents drive themselves and real combat happens', () => {
    // Two AIs drive themselves through the sim (no human input). We assert that
    // combat actually occurs (hits land, health is lost) rather than that it ends
    // in a timed KO — whether a KO lands within a fixed budget is RNG-dependent,
    // but that the AIs fight is not.
    const sim = new CombatSim('berserker', 'phantom')
    sim.attachAI('p1', AIDifficulty.Medium)
    sim.attachAI('p2', AIDifficulty.Medium)

    let totalHits = 0
    for (let i = 0; i < 7200 && !sim.isOver; i++) {
      const events = sim.step(1 / 60) // both fighters AI-driven; no provided input
      for (const e of events) if (e.kind === 'hit' && !e.event.blocked) totalHits++
    }

    const snap = sim.snapshot()
    expect(totalHits).toBeGreaterThan(0) // the AIs actually landed clean hits
    expect(Math.min(snap.fighters.p1.health, snap.fighters.p2.health)).toBeLessThan(100) // damage was dealt
  })

  it('emits attackStart and advances attackProgress so the renderer can drive clips/trails', () => {
    const sim = new CombatSim('berserker', 'phantom')
    const inA = new InputSystem()
    const inB = new InputSystem() // p2 idle (sim requires input-or-AI per fighter)
    const inputs = { p1: inA, p2: inB }

    expect(sim.attackProgress('p1')).toBe(0) // idle

    inA.triggerAction(Action.LightAttack)
    const events = sim.step(1 / 60, inputs)
    expect(events.some((e) => e.kind === 'attackStart' && e.fighter === 'p1')).toBe(true)

    // Mid-swing progress climbs above 0…
    let sawMidSwing = false
    for (let i = 0; i < 30; i++) {
      sim.step(1 / 60, inputs)
      if (sim.attackProgress('p1') > 0) sawMidSwing = true
    }
    expect(sawMidSwing).toBe(true)

    // …and returns to 0 once the swing finishes (no re-trigger).
    for (let i = 0; i < 60; i++) sim.step(1 / 60, inputs)
    expect(sim.attackProgress('p1')).toBe(0)
  })
})
