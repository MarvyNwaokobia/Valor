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
  reason: 'hp_zero' | 'timeout' | 'forfeit' | 'disconnect_timeout'
}

/** A room-level pause — either OUR OWN connection dropped and is trying to
 *  get back in, or the OPPONENT's did and we're waiting on them. Distinct
 *  from `phase`, which stays 'fighting' throughout (the match isn't over,
 *  it's frozen — see arena_server.rs's `RECONNECT_GRACE`). */
export interface ArenaPause {
  reason: 'opponent_disconnected' | 'reconnecting'
  graceSeconds: number
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
  pause: ArenaPause | null
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
  | { t: 'OPPONENT_DISCONNECTED'; graceSeconds: number }
  | { t: 'OPPONENT_RECONNECTED' }
  | { t: 'SELF_RECONNECTING'; graceSeconds: number }
  | { t: 'SELF_RECONNECTED'; resumed: boolean }

const INIT: ArenaState = { phase: 'idle', opponent: null, countdown: 3, result: null, error: null, pause: null }

/** Mirrors arena_server.rs's RECONNECT_GRACE (25s) with headroom, so if both
 *  sides are racing to resolve a drop, the SERVER's forfeit-timeout always
 *  wins — this client-side deadline giving up is a fallback for "the server
 *  itself became unreachable", not the normal path. */
const RECONNECT_WINDOW_MS = 28_000
const RECONNECT_RETRY_MS = 1_500

function reduce(s: ArenaState, a: Msg): ArenaState {
  switch (a.t) {
    case 'CONNECTING': return { ...INIT, phase: 'connecting' }
    case 'WAITING':     return { ...s, phase: 'waiting', pause: null }
    case 'MATCH_FOUND': return { ...s, phase: 'countdown', opponent: a.opponent, countdown: a.countdown, pause: null }
    case 'COUNTDOWN':   return { ...s, countdown: a.value }
    case 'FIGHT_START': return { ...s, phase: 'fighting', pause: null }
    case 'END':          return { ...s, phase: 'result', result: a.result, pause: null }
    case 'RESET':         return INIT
    case 'ERROR':          return { ...s, error: a.message }
    case 'OPPONENT_DISCONNECTED': return { ...s, pause: { reason: 'opponent_disconnected', graceSeconds: a.graceSeconds } }
    case 'OPPONENT_RECONNECTED':  return { ...s, pause: null }
    case 'SELF_RECONNECTING':     return { ...s, pause: { reason: 'reconnecting', graceSeconds: a.graceSeconds } }
    case 'SELF_RECONNECTED':      return { ...s, phase: 'fighting', pause: a.resumed ? null : { reason: 'opponent_disconnected', graceSeconds: 25 } }
    default: return s
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Live connection to one Face-Off match. `state` (phase/opponent/countdown/
 * result/pause) is reducer-driven and fine to render from directly — it
 * changes at most a few times a second. `state_update`/`hit_confirm` are NOT:
 * the server broadcasts a snapshot ~20 times a second, and re-rendering React
 * at that rate for raw position data would be wasteful. Those are written to
 * refs instead (`latestPlayers`, `pendingHits`) for the scene's own render
 * loop to read directly every frame — the same "read a ref, don't dispatch"
 * idiom a `useFrame` loop already uses everywhere else in this engine.
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

  // ── Reconnect bookkeeping ────────────────────────────────────────────────
  // `duelIdRef` remembers what to rejoin on a retry. `intentionalRef` guards
  // onclose from treating our OWN disconnect()/forfeit() close as something
  // to recover from. `reconnectDeadlineRef` is the client-side give-up point
  // for the whole retry loop (null = not currently mid-recovery).
  const duelIdRef = useRef<string | null>(null)
  const intentionalRef = useRef(false)
  const reconnectDeadlineRef = useRef<number | null>(null)
  const reconnectRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearReconnectRetry = () => {
    if (reconnectRetryTimer.current) { clearTimeout(reconnectRetryTimer.current); reconnectRetryTimer.current = null }
    reconnectDeadlineRef.current = null
  }

  /** Latest `openSocket` — read from `onclose`, which closes over whatever
   *  `openSocket` identity existed when the socket was OPENED, not the
   *  current one. A ref sidesteps that without a circular useCallback dep. */
  const openSocketRef = useRef<(duelId: string, isReconnect: boolean) => void>(() => {})

  const openSocket = useCallback((duelId: string, isReconnect: boolean) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    const socket = new WebSocket(`${wsUrl}/ws/arena`)
    ws.current = socket
    intentionalRef.current = false

    if (!isReconnect) {
      dispatch({ t: 'CONNECTING' })
      armStuckTimer(20_000, "Couldn't reach the arena server — try again.")
    }

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
          clearReconnectRetry()
          dispatch({ t: 'END', result: { result: msg.result as MatchResult['result'], reason: msg.reason as MatchResult['reason'] } })
          break

        case 'opponent_disconnected':
          // The opponent dropped — arena_server.rs pauses the match (ticking
          // frozen, HP/position held) rather than ending it, so this is a
          // "hang on" banner, not a terminal outcome. `opponent_reconnected`
          // or a `match_end` (disconnect_timeout) resolves it either way.
          dispatch({ t: 'OPPONENT_DISCONNECTED', graceSeconds: (msg.grace_seconds as number) ?? 25 })
          break

        case 'opponent_reconnected':
          dispatch({ t: 'OPPONENT_RECONNECTED' })
          break

        case 'reconnected': {
          // The server's answer to OUR OWN reconnect attempt.
          clearStuckTimer()
          clearReconnectRetry()
          const players = (msg.players as PlayerSnapshot[]) ?? []
          for (const p of players) latestPlayers.current.set(p.wallet, p)
          dispatch({ t: 'SELF_RECONNECTED', resumed: !!msg.resumed })
          break
        }

        case 'error':
          clearStuckTimer()
          dispatch({ t: 'ERROR', message: msg.message as string })
          break
      }
    }

    socket.onclose = () => {
      clearStuckTimer()
      if (intentionalRef.current) return // our own disconnect()/forfeit() — nothing to recover

      const cur = stateRef.current
      if (cur.phase !== 'countdown' && cur.phase !== 'fighting') {
        // Not (yet) in a live match — no stake is frozen mid-fight from a
        // drop at this stage, just reset as before.
        dispatch({ t: 'ERROR', message: 'Connection lost.' })
        dispatch({ t: 'RESET' })
        return
      }

      // Mid-match: try to get back into the SAME room within the server's
      // grace window instead of giving up immediately — this is the actual
      // point of arena_server.rs's reconnect support. Only start a fresh
      // deadline on the FIRST drop of a retry sequence; a retry attempt that
      // itself fails to open re-enters this same onclose and must not reset
      // the clock.
      if (reconnectDeadlineRef.current === null) {
        reconnectDeadlineRef.current = Date.now() + RECONNECT_WINDOW_MS
        dispatch({ t: 'SELF_RECONNECTING', graceSeconds: Math.round(RECONNECT_WINDOW_MS / 1000) })
      }
      const deadline = reconnectDeadlineRef.current
      if (Date.now() >= deadline) {
        clearReconnectRetry()
        dispatch({ t: 'ERROR', message: "Lost connection and couldn't reconnect in time. Your stake is safe either way — check your Face-Off history." })
        dispatch({ t: 'RESET' })
        return
      }
      reconnectRetryTimer.current = setTimeout(() => {
        openSocketRef.current(duelId, true)
      }, RECONNECT_RETRY_MS)
    }

    socket.onerror = () => {
      clearStuckTimer()
      // Mid-match, a retry is already scheduled from onclose (every browser
      // fires close after error) — don't also surface a terminal error here.
      const cur = stateRef.current
      if (!intentionalRef.current && (cur.phase === 'countdown' || cur.phase === 'fighting')) return
      dispatch({ t: 'ERROR', message: 'Could not connect to the arena.' })
    }
  }, [walletAddress])

  openSocketRef.current = openSocket

  const connect = useCallback((duelId: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    duelIdRef.current = duelId
    clearReconnectRetry()
    openSocket(duelId, false)
  }, [openSocket])

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

  /** The Exit button — a deliberate quit, distinct from just closing the
   *  socket. Sent BEFORE disconnecting so the server can settle it as a real
   *  forfeit-win for the opponent (see `ServerMsg::Forfeit`'s doc) rather
   *  than the reconnect-eligible path an ordinary connection drop takes. */
  const forfeit = useCallback(() => {
    if (ws.current?.readyState !== WebSocket.OPEN) return
    ws.current.send(JSON.stringify({ type: 'forfeit' }))
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
    intentionalRef.current = true
    clearStuckTimer()
    clearReconnectRetry()
    duelIdRef.current = null
    ws.current?.close()
    ws.current = null
    latestPlayers.current.clear()
    pendingHits.current = []
    dispatch({ t: 'RESET' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => { intentionalRef.current = true; clearStuckTimer(); clearReconnectRetry(); ws.current?.close() }, [])

  return { state, connect, sendInput, drainHits, latestPlayers, disconnect, forfeit }
}
