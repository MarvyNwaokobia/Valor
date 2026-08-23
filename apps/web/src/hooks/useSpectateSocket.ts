'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { PlayerSnapshot, HitEvent } from './useArenaSocket'

export type SpectatePhase = 'connecting' | 'watching' | 'ended' | 'error'

export interface SpectateResult {
  winnerWallet: string | null
  reason: string
}

/**
 * Read-only viewer for a live Face-Off match — "anyone with the link", no
 * wallet or stake involved. Deliberately a SEPARATE, smaller hook from
 * `useArenaSocket` rather than a spectate branch bolted onto it: a viewer
 * never joins, never sends input, never reconnects into a paused match (if
 * the match pauses, the viewer just sees ticks stop, same as everyone else
 * watching state freeze) — threading that state machine's reconnect/forfeit
 * logic through for a connection that can't do either would only add
 * branches nothing here needs.
 */
export function useSpectateSocket(duelId: string) {
  const [phase, setPhase] = useState<SpectatePhase>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SpectateResult | null>(null)

  /** Same "read a ref every frame, don't dispatch" idiom useArenaSocket uses
   *  for its own 20Hz snapshots — a spectator view re-rendering React at
   *  that rate for raw position data would be exactly as wasteful here. */
  const latestPlayers = useRef<Map<string, PlayerSnapshot>>(new Map())
  const pendingHits = useRef<HitEvent[]>([])

  useEffect(() => {
    let closedIntentionally = false
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    const socket = new WebSocket(`${wsUrl}/ws/arena`)

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'spectate', duel_id: duelId }))
    }

    socket.onmessage = (e) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(e.data as string) }
      catch { return }

      switch (msg.type) {
        case 'spectate_joined': {
          const players = (msg.players as PlayerSnapshot[]) ?? []
          for (const p of players) latestPlayers.current.set(p.wallet, p)
          setPhase('watching')
          break
        }
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
        case 'spectate_match_end':
          setResult({ winnerWallet: (msg.winner_wallet as string | null) ?? null, reason: msg.reason as string })
          setPhase('ended')
          break
        case 'error':
          setError(msg.message as string)
          setPhase('error')
          break
      }
    }

    socket.onerror = () => {
      if (closedIntentionally) return
      setError('Could not connect to the arena.')
      setPhase('error')
    }

    socket.onclose = () => {
      if (closedIntentionally) return
      setPhase((p) => (p === 'ended' ? p : 'error'))
    }

    return () => {
      closedIntentionally = true
      socket.close()
    }
  }, [duelId])

  /** Drains and returns hits since the last call — same contract as
   *  FpsSim.drain() / useArenaSocket.drainHits. */
  const drainHits = useCallback((): HitEvent[] => {
    if (pendingHits.current.length === 0) return []
    const out = pendingHits.current
    pendingHits.current = []
    return out
  }, [])

  return { phase, error, result, latestPlayers, drainHits }
}
