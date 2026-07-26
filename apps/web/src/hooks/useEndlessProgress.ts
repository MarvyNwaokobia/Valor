import { useCallback, useRef, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface WaveResult {
  wave: number
  gAwarded: number
  rankedUp: boolean
  prestiged: boolean
}

/**
 * Persistent Endless / Seasonal progress.
 *
 * The rules, as decided:
 *   • Quitting never costs progress — reopening resumes on the wave you left.
 *   • DYING drops you to the START of your current wave, not to wave 1. The stored
 *     wave is unchanged by a death; you just re-run that wave's rooms.
 *   • The board ranks WAVES COMPLETED, which is `wave - 1` and only ever goes up.
 *
 * `seasonId` partitions it: pass a season's id for the Seasonal Campaign (each
 * season starts everyone from scratch), omit it for Campaign Endless.
 *
 * The server owns the wave count — the client only ever says "I cleared the next
 * one" — so none of this is trusted from here.
 */
export function useEndlessProgress(walletAddress: string | undefined, seasonId?: string) {
  const sessionRef = useRef<string | null>(null)
  const [wave, setWave] = useState(1)
  const [banked, setBanked] = useState(0) // G$ earned this session
  const [ready, setReady] = useState(false)

  const body = useCallback(
    (extra: Record<string, unknown>) => JSON.stringify({ wallet: walletAddress, season_id: seasonId, ...extra }),
    [walletAddress, seasonId],
  )

  /** Open a session and return the wave to resume on. */
  const start = useCallback(async (): Promise<number> => {
    sessionRef.current = null
    setBanked(0)
    setReady(false)
    if (!walletAddress) { setReady(true); return 1 }
    try {
      const res = await fetch(`${API}/endless/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body({}),
      })
      if (res.ok) {
        const data = await res.json()
        sessionRef.current = data.session_id ?? null
        const resume = Math.max(1, Number(data.wave) || 1)
        setWave(resume)
        setReady(true)
        return resume
      }
    } catch {
      /* offline — the run still plays, it just earns and saves nothing */
    }
    setReady(true)
    return 1
  }, [walletAddress, body])

  /** Report a cleared wave. The server credits it, pays the G$ and records the win. */
  const clearWave = useCallback(async (): Promise<WaveResult | null> => {
    const session_id = sessionRef.current
    if (!session_id) return null
    try {
      const res = await fetch(`${API}/endless/wave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id, season_id: seasonId }),
      })
      if (!res.ok) {
        if (res.status === 404) sessionRef.current = null // expired: stop earning, keep playing
        return null
      }
      const d = await res.json()
      const g = Number(d.g_awarded) || 0
      setBanked((b) => b + g)
      setWave(Number(d.wave) + 1)
      return { wave: Number(d.wave), gAwarded: g, rankedUp: !!d.ranked_up, prestiged: !!d.prestiged }
    } catch {
      return null
    }
  }, [seasonId])

  /** Report a death. Records the loss on-chain; the stored wave does NOT move. */
  const reportDeath = useCallback(async (diedOnWave: number) => {
    if (!walletAddress) return
    try {
      await fetch(`${API}/endless/death`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body({ wave: diedOnWave }),
      })
    } catch {
      /* the run is over either way — never block the UI on this */
    }
  }, [walletAddress, body])

  return { wave, banked, ready, start, clearWave, reportDeath }
}
