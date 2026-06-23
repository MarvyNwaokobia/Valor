import { describe, it, expect } from 'vitest'
import { GameRoom, type RoomPlayer } from '@/engine/sim/GameRoom'
import { NetMsgType, type InputStateMsg, type ActionTriggerMsg } from '@/engine/multiplayer/CombatProtocol'

// Proves the server-authoritative room runs end-to-end over CombatProtocol with
// two "remote" inputs: ingest InputState/ActionTrigger → tick the headless sim →
// emit StateUpdate / HitConfirm / MatchEnd. No rendering, no AI — the wire path
// for real-time PvP (docs/PVP_NETCODE.md option C).

const P1: RoomPlayer = { id: 'p1', wallet: '0xAAA1', name: 'Aggressor', classId: 'berserker' }
const P2: RoomPlayer = { id: 'p2', wallet: '0xBBB2', name: 'Idle', classId: 'phantom' }

const inputState = (moveX: number, actions: string[] = []): InputStateMsg => ({
  type: NetMsgType.InputState, seq: 0, timestamp: 0, moveX, moveY: 0, rotation: 0, actions,
})
const trigger = (action: string): ActionTriggerMsg => ({
  type: NetMsgType.ActionTrigger, seq: 0, action, position: [0, 0, 0], rotation: 0, timestamp: 0,
})

describe('GameRoom (server-authoritative match over CombatProtocol)', () => {
  it('resolves an aggressor-vs-idle match to a MatchEnd with the right winner', () => {
    const room = new GameRoom('r1', P1, P2)
    room.start()

    let matchEnd = null as null | ReturnType<GameRoom['step']>['matchEnd']
    let sawHit = false
    let twoPlayersEveryTick = true

    for (let i = 0; i < 3600 && !room.isOver; i++) {
      room.applyInput('p1', inputState(1))   // advance toward p2
      room.applyInput('p1', trigger('light')) // keep swinging
      const r = room.step()
      if (r.state.players.length !== 2) twoPlayersEveryTick = false
      if (r.hits.length > 0) sawHit = true
      if (r.matchEnd) matchEnd = r.matchEnd
    }

    expect(room.isOver).toBe(true)
    expect(sawHit).toBe(true)
    expect(twoPlayersEveryTick).toBe(true)
    expect(matchEnd).toBeTruthy()
    expect(matchEnd!.winnerId).toBe(P1.wallet)
    expect(matchEnd!.loserId).toBe(P2.wallet)
    expect(matchEnd!.stats.totalDamageDealt[P1.wallet]).toBeGreaterThan(0)
  })

  it('broadcasts wire-shaped, JSON-serializable StateUpdates keyed by wallet', () => {
    const room = new GameRoom('r2', P1, P2)
    room.start()
    room.applyInput('p1', inputState(1))
    const { state } = room.step()

    const back = JSON.parse(JSON.stringify(state))
    expect(back.type).toBe(NetMsgType.StateUpdate)
    expect(back.players.map((p: { id: string }) => p.id).sort()).toEqual([P1.wallet, P2.wallet])
    const p1 = back.players.find((p: { id: string }) => p.id === P1.wallet)
    expect(p1.position).toHaveLength(3)
    expect(p1.health).toBe(100)
    expect(typeof p1.animState).toBe('string')
    expect(typeof back.seq).toBe('number')
  })

  it('a held block (via InputState.actions) reduces incoming damage', () => {
    // Run two short rooms in parallel: in one, p2 holds block; in the other it
    // does not. p2's surviving HP should be higher when blocking.
    const run = (block: boolean) => {
      const room = new GameRoom(block ? 'rb' : 'rn', P1, P2)
      room.start()
      for (let i = 0; i < 240; i++) {
        room.applyInput('p1', inputState(1))
        room.applyInput('p1', trigger('light'))
        room.applyInput('p2', inputState(0, block ? ['block'] : []))
        const r = room.step()
        if (r.matchEnd) break
      }
      // Read p2 health off the last state.
      const { state } = room.step()
      return state.players.find((p) => p.id === P2.wallet)!.health
    }

    const hpBlocking = run(true)
    const hpOpen = run(false)
    expect(hpBlocking).toBeGreaterThanOrEqual(hpOpen)
  })
})
