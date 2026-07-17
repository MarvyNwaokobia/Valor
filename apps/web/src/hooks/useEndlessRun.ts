import { useCallback, useRef, useState } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'
import type { Player } from '@/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface WaveResult {
  wave: number
  gAwarded: number
  rankedUp: boolean
  newRank: Player['rank'] | null
  prestiged: boolean
  prestigeLevel: number
}

/**
 * Drives a server-authoritative Endless run. The server owns the wave count and pays
 * G$ per wave; this hook just opens the run, reports each cleared wave, and closes it.
 * A run with no session (offline at start) still plays — it simply earns nothing, since
 * only a server-issued session can mint wave G$.
 */
export function useEndlessRun(walletAddress: string | undefined) {
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)
  const sessionRef = useRef<string | null>(null)
  const [banked, setBanked] = useState(0)          // total G$ earned this run
  const [lastGain, setLastGain] = useState(0)      // last wave's G$ (drives the toast)

  // Open a fresh run. Resets the running total.
  const startRun = useCallback(async () => {
    sessionRef.current = null
    setBanked(0)
    setLastGain(0)
    if (!walletAddress) return
    try {
      const res = await fetch(`${API}/endless/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: walletAddress }),
      })
      if (res.ok) sessionRef.current = (await res.json()).session_id ?? null
    } catch {
      /* offline — no session; the run still plays, just unpaid */
    }
  }, [walletAddress])

  // Report one cleared wave. Returns the server's authoritative result, or null.
  const reportWave = useCallback(async (): Promise<WaveResult | null> => {
    const session_id = sessionRef.current
    if (!session_id) return null
    try {
      const res = await fetch(`${API}/endless/wave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id }),
      })
      if (!res.ok) {
        // A dropped/expired session ends earning for the run but never crashes play.
        if (res.status === 404) sessionRef.current = null
        return null
      }
      const d = await res.json()
      const g: number = d.g_awarded ?? 0

      // Mirror the server's authoritative result into the store.
      const updates: Partial<Player> = { xp: d.new_xp }
      if (d.ranked_up && d.new_rank) updates.rank = d.new_rank
      if (typeof d.prestige_level === 'number') updates.prestige_level = d.prestige_level
      if (g > 0) {
        const cur = usePlayerStore.getState().player?.g_earned_lifetime ?? 0
        updates.g_earned_lifetime = cur + g
        setBanked((b) => b + g)
        setLastGain(g)
      }
      updatePlayer(updates)

      return {
        wave: d.wave,
        gAwarded: g,
        rankedUp: d.ranked_up ?? false,
        newRank: d.new_rank ?? null,
        prestiged: d.prestiged ?? false,
        prestigeLevel: d.prestige_level ?? 0,
      }
    } catch {
      return null
    }
  }, [updatePlayer])

  // Close the run — the server writes the leaderboard score from its own wave count.
  const endRun = useCallback(async () => {
    const session_id = sessionRef.current
    sessionRef.current = null
    if (!session_id) return
    try {
      await fetch(`${API}/endless/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id }),
      })
    } catch {
      /* best-effort; the session also expires server-side on its own */
    }
  }, [])

  return { startRun, reportWave, endRun, banked, lastGain }
}
