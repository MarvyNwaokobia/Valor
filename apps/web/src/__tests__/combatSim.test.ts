import { describe, it, expect } from 'vitest'
import { CombatSim, type FighterId } from '@/engine/sim/CombatSim'
import { InputSystem, Action } from '@/engine/input/InputSystem'

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
})
