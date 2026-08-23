'use client'

import { useCallback, useEffect, useRef, useReducer } from 'react'

// ── Public types ──────────────────────────────────────────────────────────────
//
// Mirrors the wire protocol in apps/api/src/services/coop_server.rs. Unlike
// useArenaSocket.ts's ArenaInput/PlayerSnapshot/HitEvent, this hook does NOT
// type the host-state snapshot or peer-input payload shapes — the relay
// server itself treats them as opaque JSON (see coop_server.rs's module
// doc), and so does this hook. `FpsWorld` (ValorScene.tsx) is the only place
// that needs to know what's actually inside them.

export type PartyPhase = 'idle' | 'connecting' | 'lobby' | 'running' | 'ended'

export interface MemberInfo {
  wallet: string
  name: string
}

interface PartyState {
  phase: PartyPhase
  code: string | null
  seed: number | null
  isHost: boolean
  hostWallet: string | null
  members: MemberInfo[]
  error: string | null
}

type Msg =
  | { t: 'CONNECTING' }
  | { t: 'PARTY_CREATED'; code: string; seed: number; wallet: string; name: string }
  | { t: 'PARTY_JOINED'; code: string; seed: number; hostWallet: string; members: MemberInfo[] }
  | { t: 'MEMBER_JOINED'; member: MemberInfo }
  | { t: 'MEMBER_LEFT'; wallet: string }
  | { t: 'RUN_STARTED' }
  | { t: 'HOST_LEFT' }
  | { t: 'ERROR'; message: string }
  | { t: 'RESET' }

const INIT: PartyState = {
  phase: 'idle', code: null, seed: null, isHost: false, hostWallet: null, members: [], error: null,
}

function reduce(s: PartyState, a: Msg): PartyState {
  switch (a.t) {
    case 'CONNECTING': return { ...INIT, phase: 'connecting' }
    case 'PARTY_CREATED':
      return { ...s, phase: 'lobby', code: a.code, seed: a.seed, isHost: true, hostWallet: a.wallet, members: [{ wallet: a.wallet, name: a.name }] }
    case 'PARTY_JOINED':
      return { ...s, phase: 'lobby', code: a.code, seed: a.seed, isHost: false, hostWallet: a.hostWallet, members: a.members }
    case 'MEMBER_JOINED':
      return s.members.some((m) => m.wallet === a.member.wallet) ? s : { ...s, members: [...s.members, a.member] }
    case 'MEMBER_LEFT':
      return { ...s, members: s.members.filter((m) => m.wallet !== a.wallet) }
    case 'RUN_STARTED': return { ...s, phase: 'running' }
    // The host owns the one authoritative sim (see coop_server.rs's module
    // doc) — no migration in v1, so this is terminal for everyone else.
    case 'HOST_LEFT': return { ...s, phase: 'ended', error: 'The host left the party.' }
    case 'ERROR': return { ...s, error: a.message }
    case 'RESET': return INIT
    default: return s
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Live connection to one co-op Endless party. `state` (phase/code/members/
 * etc.) is reducer-driven and fine to render from directly — it changes at
 * most a few times a second. `latestHostSnapshot`/`latestPeerInputs` are
 * NOT: the host broadcasts several times a second and a non-host client's
 * own input is sent every frame, so both are refs read directly by
 * `FpsWorld`'s render loop rather than dispatched, same "read a ref, don't
 * re-render React for it" idiom `useArenaSocket.ts` already uses for
 * `latestPlayers`.
 *
 * Reconnect is deliberately much simpler than `useArenaSocket.ts`'s: nothing
 * is staked, so a dropped connection just surfaces an error and resets to
 * `idle` — a non-host player rejoins by calling `joinParty` again with the
 * same code, no automatic retry loop needed.
 */
export function useCoopSocket(walletAddress: string) {
  const [state, dispatch] = useReducer(reduce, INIT)
  const ws = useRef<WebSocket | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  /** The host's latest `sim.snapshot()`, opaque to this hook. Read every
   *  frame by non-host clients; null until the first broadcast arrives. */
  const latestHostSnapshot = useRef<unknown>(null)
  /** Each non-host member's latest reported position/aim/fire-intent,
   *  wallet -> payload — overwritten each tick like `latestPlayers`, not
   *  drained like a discrete event queue. Read every frame by the host. */
  const latestPeerInputs = useRef<Map<string, unknown>>(new Map())
  /** Wave numbers the host has reported cleared since the last drain —
   *  mirrors `useArenaSocket.ts`'s `drainHits()` contract for a genuinely
   *  discrete, one-shot event. */
  const pendingWaveClears = useRef<number[]>([])

  const intentionalRef = useRef(false)

  const openSocket = useCallback((onOpenMsg: Record<string, unknown>) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    const socket = new WebSocket(`${wsUrl}/ws/coop`)
    ws.current = socket
    intentionalRef.current = false
    dispatch({ t: 'CONNECTING' })

    socket.onopen = () => {
      socket.send(JSON.stringify(onOpenMsg))
    }

    socket.onmessage = (e) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(e.data as string) }
      catch { return }

      switch (msg.type) {
        case 'party_created':
          dispatch({
            t: 'PARTY_CREATED', code: msg.code as string, seed: msg.seed as number,
            wallet: walletAddress, name: (onOpenMsg.name as string) ?? '',
          })
          break

        case 'party_joined':
          dispatch({
            t: 'PARTY_JOINED', code: msg.code as string, seed: msg.seed as number,
            hostWallet: msg.host_wallet as string, members: msg.members as MemberInfo[],
          })
          break

        case 'member_joined':
          dispatch({ t: 'MEMBER_JOINED', member: { wallet: msg.wallet as string, name: msg.name as string } })
          break

        case 'member_left':
          dispatch({ t: 'MEMBER_LEFT', wallet: msg.wallet as string })
          break

        case 'run_started':
          dispatch({ t: 'RUN_STARTED' })
          break

        case 'state_update':
          latestHostSnapshot.current = msg.snapshot
          break

        case 'peer_input':
          latestPeerInputs.current.set(msg.wallet as string, msg.payload)
          break

        case 'wave_cleared':
          pendingWaveClears.current.push(msg.wave as number)
          break

        case 'host_left':
          dispatch({ t: 'HOST_LEFT' })
          break

        case 'error':
          dispatch({ t: 'ERROR', message: msg.message as string })
          break
      }
    }

    socket.onclose = () => {
      if (intentionalRef.current) return // our own leaveParty()/disconnect()
      const cur = stateRef.current
      if (cur.phase === 'lobby' || cur.phase === 'running') {
        dispatch({ t: 'ERROR', message: 'Connection lost. If you were mid-run, nothing was at stake — just rejoin.' })
      }
      dispatch({ t: 'RESET' })
    }

    socket.onerror = () => {
      dispatch({ t: 'ERROR', message: 'Could not connect to the party server.' })
    }
  }, [walletAddress])

  const createParty = useCallback((name: string) => {
    openSocket({ type: 'create_party', wallet: walletAddress, name })
  }, [walletAddress, openSocket])

  const joinParty = useCallback((code: string, name: string) => {
    openSocket({ type: 'join_party', code, wallet: walletAddress, name })
  }, [walletAddress, openSocket])

  const startRun = useCallback(() => {
    if (ws.current?.readyState !== WebSocket.OPEN) return
    ws.current.send(JSON.stringify({ type: 'start_run' }))
  }, [])

  /** Host only — broadcasts `sim.snapshot()` (any JSON-serializable value,
   *  not pre-stringified; this hook owns the one `JSON.stringify` call so
   *  callers can't accidentally double-encode it). */
  const sendHostState = useCallback((snapshot: unknown) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return
    ws.current.send(JSON.stringify({ type: 'host_state', snapshot }))
  }, [])

  /** Non-host only — this frame's position/aim/fire-intent. Not throttled
   *  here; the caller (`FpsWorld`'s render loop) decides its own send rate,
   *  same contract `useArenaSocket.ts`'s `sendInput` already uses. */
  const sendRemoteInput = useCallback((payload: unknown) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return
    ws.current.send(JSON.stringify({ type: 'remote_input', payload }))
  }, [])

  /** Host only — the host's own wave-clear detection, fanned out so every
   *  member's client independently fires its own `/endless/wave` call. */
  const sendWaveCleared = useCallback((wave: number) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return
    ws.current.send(JSON.stringify({ type: 'wave_cleared', wave }))
  }, [])

  /** Drains and returns wave-clear numbers since the last call — same
   *  contract as `useArenaSocket.ts`'s `drainHits()`. */
  const drainWaveClears = useCallback((): number[] => {
    if (pendingWaveClears.current.length === 0) return []
    const out = pendingWaveClears.current
    pendingWaveClears.current = []
    return out
  }, [])

  const leaveParty = useCallback(() => {
    intentionalRef.current = true
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'leave' }))
    }
    ws.current?.close()
    ws.current = null
    latestHostSnapshot.current = null
    latestPeerInputs.current.clear()
    pendingWaveClears.current = []
    dispatch({ t: 'RESET' })
  }, [])

  useEffect(() => () => { intentionalRef.current = true; ws.current?.close() }, [])

  return {
    state, createParty, joinParty, startRun,
    sendHostState, sendRemoteInput, sendWaveCleared, drainWaveClears,
    latestHostSnapshot, latestPeerInputs, leaveParty,
  }
}
