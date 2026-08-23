'use client'

import { useEffect, useRef, useCallback, useReducer } from 'react'

// ── Public types ──────────────────────────────────────────────────────────────
//
// Mirrors the wire protocol in apps/api/src/services/arena_server.rs exactly —
// see that file's module doc for the full message list and why the server
// never trusts a client-reported position/aim directly.

export type MatchPhase = 'idle' | 'connecting' | 'waiting' | 'countdown' | 'fighting' | 'result'

export interface OpponentInfo {
  wallet: string
  name: string
}

/** One player's state as the server understands it, straight off a
 *  `state_update` tick — never locally simulated for the remote player. */
export interface PlayerSnapshot {
  wallet: string
  x: number
  z: number
  yaw: number
  pitch: number
  hp: number
  ammo: number
  reloading: boolean
  crouching: boolean
  ads: boolean
}

export interface HitEvent {
  shooter: string
  target: string
  part: 'head' | 'body'
  damage: number
  target_hp: number
}

export interface MatchResult {
  result: 'win' | 'loss' | 'draw'
  reason: 'hp_zero' | 'timeout'
}

/** What a client asks the server to do this frame — a REQUEST, not a fact.
 *  See arena_server.rs: movement is clamped to the arena, aim can only turn
 *  at a bounded rate, so sending an extreme value here doesn't teleport
 *  anything — it just says what direction to keep turning/walking toward. */
export interface ArenaInput {
  moveX: number
  moveY: number
  yaw: number
  pitch: number
  firing: boolean
  wantReload: boolean
  crouching: boolean
  ads: boolean
}

interface ArenaState {
  phase: MatchPhase
  opponent: OpponentInfo | null
  countdown: number
  result: MatchResult | null
  error: string | null
}

type Msg =
  | { t: 'CONNECTING' }
  | { t: 'WAITING' }
  | { t: 'MATCH_FOUND'; opponent: OpponentInfo; countdown: number }
  | { t: 'COUNTDOWN'; value: number }
  | { t: 'FIGHT_START' }
  | { t: 'END'; result: MatchResult }
  | { t: 'RESET' }
  | { t: 'ERROR'; message: string }

const INIT: ArenaState = { phase: 'idle', opponent: null, countdown: 3, result: null, error: null }

function reduce(s: ArenaState, a: Msg): ArenaState {
  switch (a.t) {
    case 'CONNECTING': return { ...INIT, phase: 'connecting' }
    case 'WAITING':     return { ...s, phase: 'waiting' }
    case 'MATCH_FOUND': return { ...s, phase: 'countdown', opponent: a.opponent, countdown: a.countdown }
    case 'COUNTDOWN':   return { ...s, countdown: a.value }
    case 'FIGHT_START': return { ...s, phase: 'fighting' }
    case 'END':          return { ...s, phase: 'result', result: a.result }
    case 'RESET':         return INIT
    case 'ERROR':          return { ...s, error: a.message }
    default: return s
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Live connection to one Face-Off match. `state` (phase/opponent/countdown/
 * result) is reducer-driven and fine to render from directly — it changes at
 * most a few times a second. `state_update`/`hit_confirm` are NOT: the server
 * broadcasts a snapshot ~20 times a second, and re-rendering React at that
 * rate for raw position data would be wasteful. Those are written to refs
 * instead (`latestPlayers`, `pendingHits`) for the scene's own render loop to
 * read directly every frame — the same "read a ref, don't dispatch" idiom
 * a `useFrame` loop already uses everywhere else in this engine.
 */
export function useArenaSocket(walletAddress: string) {
  const [state, dispatch] = useReducer(reduce, INIT)
  const ws = useRef<WebSocket | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  /** Latest state_update, wallet -> snapshot. Read, never dispatched. */
  const latestPlayers = useRef<Map<string, PlayerSnapshot>>(new Map())
  /** Hit events since the scene last drained them — mirrors FpsSim's
   *  drain() pattern for VFX/hitmarker triggering without a re-render. */
  const pendingHits = useRef<HitEvent[]>([])

  /** The 2026-08-23 incident: a client that silently never reached the
   *  server left a player staring at "waiting for opponent" forever, with
   *  no way to tell "still legitimately waiting" from "something's wrong"
   *  apart from watching a clock themselves. This is that clock — a single
   *  in-flight timer, re-armed at each stage with a budget appropriate to
   *  it, cleared the moment that stage is actually left. It does NOT touch
   *  the stake either way; a stuck match is recoverable via the admin void
   *  endpoint regardless of what this says.
   */
  const stuckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearStuckTimer = () => {
    if (stuckTimer.current) { clearTimeout(stuckTimer.current); stuckTimer.current = null }
  }
  const armStuckTimer = (ms: number, message: string) => {
    clearStuckTimer()
    stuckTimer.current = setTimeout(() => {
      dispatch({ t: 'ERROR', message })
      dispatch({ t: 'RESET' })
      ws.current?.close()
    }, ms)
  }

  const connect = useCallback((duelId: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) return

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    const socket = new WebSocket(`${wsUrl}/ws/arena`)
    ws.current = socket
    dispatch({ t: 'CONNECTING' })
    armStuckTimer(20_000, "Couldn't reach the arena server — try again.")

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'join', duel_id: duelId, wallet: walletAddress }))
    }

    socket.onmessage = (e) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(e.data as string) }
      catch { return }

      switch (msg.type) {
        case 'waiting_for_opponent':
          dispatch({ t: 'WAITING' })
          // A legitimate wait covers however long the OTHER player takes to
          // accept (async) plus their own connect — generous on purpose, but
          // not infinite. If they never show, this is what turns silence
          // into an actionable message instead of an indefinite spinner.
          armStuckTimer(90_000, "Still haven't found your opponent — they may not have connected. Your stake is safe either way; check your Face-Off history.")
          break

        case 'match_found': {
          clearStuckTimer()
          const opp = msg.opponent as OpponentInfo
          const countdown = (msg.countdown as number) ?? 3
          dispatch({ t: 'MATCH_FOUND', opponent: opp, countdown })
          let count = countdown
          const tick = setInterval(() => {
            count -= 1
            if (count <= 0) clearInterval(tick)
            else dispatch({ t: 'COUNTDOWN', value: count })
          }, 1000)
          break
        }

        case 'fight_start':
          clearStuckTimer()
          dispatch({ t: 'FIGHT_START' })
          break

        case 'state_update': {
          const players = (msg.players as PlayerSnapshot[]) ?? []
          for (const p of players) latestPlayers.current.set(p.wallet, p)
          break
        }

        case 'hit_confirm':
          pendingHits.current.push({
            shooter: msg.shooter as string,
            target: msg.target as string,
            part: msg.part as 'head' | 'body',
            damage: msg.damage as number,
            target_hp: msg.target_hp as number,
          })
          break

        case 'match_end':
          clearStuckTimer()
          dispatch({ t: 'END', result: { result: msg.result as MatchResult['result'], reason: msg.reason as MatchResult['reason'] } })
          break

        case 'opponent_disconnected':
          // The server tears the room down without a match_end on a
          // disconnect (see arena_server.rs's TODO on settlement there) —
          // surface it as a distinct, unresolved outcome rather than
          // pretending it was a win.
          clearStuckTimer()
          dispatch({ t: 'ERROR', message: 'Your opponent disconnected.' })
          break

        case 'error':
          clearStuckTimer()
          dispatch({ t: 'ERROR', message: msg.message as string })
          break
      }
    }

    socket.onclose = () => {
      clearStuckTimer()
      const cur = stateRef.current
      if (cur.phase === 'connecting' || cur.phase === 'waiting' || cur.phase === 'countdown' || cur.phase === 'fighting') {
        dispatch({ t: 'ERROR', message: 'Connection lost.' })
        dispatch({ t: 'RESET' })
      }
    }

    socket.onerror = () => {
      clearStuckTimer()
      dispatch({ t: 'ERROR', message: 'Could not connect to the arena.' })
    }
  }, [walletAddress])

  /** Called every frame from the scene's own render loop — not throttled
   *  here, the caller decides its own send rate. */
  const sendInput = useCallback((input: ArenaInput) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return
    ws.current.send(JSON.stringify({
      type: 'input',
      move_x: input.moveX, move_y: input.moveY,
      yaw: input.yaw, pitch: input.pitch,
      firing: input.firing, want_reload: input.wantReload,
      crouching: input.crouching, ads: input.ads,
    }))
  }, [])

  /** Drains and returns hits since the last call — same contract as
   *  FpsSim.drain(). */
  const drainHits = useCallback((): HitEvent[] => {
    if (pendingHits.current.length === 0) return []
    const out = pendingHits.current
    pendingHits.current = []
    return out
  }, [])

  const disconnect = useCallback(() => {
    clearStuckTimer()
    ws.current?.close()
    ws.current = null
    latestPlayers.current.clear()
    pendingHits.current = []
    dispatch({ t: 'RESET' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => { clearStuckTimer(); ws.current?.close() }, [])

  return { state, connect, sendInput, drainHits, latestPlayers, disconnect }
}
