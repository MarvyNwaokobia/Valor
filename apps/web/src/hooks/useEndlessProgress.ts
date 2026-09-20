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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function useEndlessProgress(walletAddress: string | undefined, seasonId?: string) {
  const sessionRef = useRef<string | null>(null)
  const [wave, setWave] = useState(1)
  const [banked, setBanked] = useState(0) // G$ earned this session
  const [ready, setReady] = useState(false)
  // Serializes clearWave() calls so a wave that's mid-retry is never overtaken by
  // the next one — each queued call waits its turn instead of racing the server's
  // own per-session wave counter.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

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

  /**
   * Re-open a session WITHOUT touching the on-screen wave or the banked total.
   *
   * `start()` is for beginning a run: it resets the display. This is for the
   * middle of one, after the server has forgotten us.
   */
  const reopenSession = useCallback(async (): Promise<string | null> => {
    if (!walletAddress) return null
    try {
      const res = await fetch(`${API}/endless/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body({}),
      })
      if (!res.ok) return null
      const data = await res.json()
      sessionRef.current = data.session_id ?? null
      return sessionRef.current
    } catch {
      return null
    }
  }, [walletAddress, body])

  /**
   * Report a cleared wave. The server credits it, pays the G$ and records the win.
   *
   * The room the player just cleared is real regardless of the network — the game
   * has already moved on to the next one by the time this is called. So a single
   * failed attempt — a dropped connection, a timeout, a rate-limit that doesn't
   * clear on the first retry — now keeps retrying with backoff instead of quietly
   * under-reporting how far the player actually got. Retrying is safe: the server
   * only advances its per-session wave counter once per call that actually lands,
   * so a retry can never double-credit a wave.
   */
  const clearWave = useCallback((): Promise<WaveResult | null> => {
    const post = async (session_id: string) =>
      fetch(`${API}/endless/wave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id, season_id: seasonId }),
      })

    const attempt = async (): Promise<WaveResult | null> => {
      const session_id = sessionRef.current ?? (await reopenSession())
      if (!session_id) return null

      let res: Response
      try {
        res = await post(session_id)
      } catch {
        return null // network error — outer loop retries
      }

      // 404 = the server has no record of this run. That is NOT the player's
      // fault: the server restarts on every deploy and its session list is in
      // memory only. Re-introduce ourselves and try again — stored progress
      // only ever moves UP and the server resumes from it, so this cannot
      // rewind anyone.
      if (res.status === 404) {
        const fresh = await reopenSession()
        if (!fresh) return null
        try {
          res = await post(fresh)
        } catch {
          return null
        }

        // A brand-new session has just been created, so the anti-script floor
        // ("you cannot clear a wave in under N seconds") sees ~0 seconds elapsed
        // and rejects the retry. The player really did spend that time — it was
        // spent against the session the server threw away — so wait out the
        // floor once and try again rather than lose the wave.
        if (res.status === 429) {
          await sleep(7000)
          try {
            res = await post(fresh)
          } catch {
            return null
          }
        }
      }

      if (!res.ok) return null

      const d = await res.json()
      const g = Number(d.g_awarded) || 0
      setBanked((b) => b + g)
      setWave(Number(d.wave) + 1)

      // Write the server's XP and rank back into the player, which this hook used to
      // throw away entirely.
      //
      // The server has always credited the XP — 50 a wave, stored, on-chain — and has
      // always returned new_xp, new_rank and prestige_level on every wave. Nothing read
      // them. So the bar and the rank badge kept showing whatever they showed when the
      // page loaded, and a player who climbed two ranks in a run saw none of it until a
      // full reload. The XP was never lost; only the news of it was.
      //
      // Guarded on a real number: the server answers 0 when its own award call failed,
      // and writing that would wipe the player's XP to zero on screen over a server-side
      // hiccup — the one way this sync could be worse than no sync at all.
      const updates: Partial<Player> = {}
      if (typeof d.new_xp === 'number' && d.new_xp > 0) updates.xp = d.new_xp
      if (d.ranked_up && d.new_rank) updates.rank = d.new_rank
      if (typeof d.prestige_level === 'number') updates.prestige_level = d.prestige_level
      if (g > 0) {
        const cur = usePlayerStore.getState().player?.g_earned_lifetime ?? 0
        updates.g_earned_lifetime = Number(cur) + g
      }
      if (Object.keys(updates).length > 0) usePlayerStore.getState().updatePlayer(updates)

      return {
        wave: Number(d.wave),
        gAwarded: g,
        rankedUp: !!d.ranked_up,
        newRank: d.new_rank ?? null,
        prestiged: !!d.prestiged,
        prestigeLevel: Number(d.prestige_level) || 0,
      }
    }

    // Never throws — attempt() itself is careful, but this is also the queue's own
    // handler, and a rejection here would poison every wave still waiting behind it.
    const withRetries = async (): Promise<WaveResult | null> => {
      const maxAttempts = 6
      let delay = 1500
      for (let i = 0; i < maxAttempts; i++) {
        let result: WaveResult | null = null
        try {
          result = await attempt()
        } catch {
          /* treat like any other failed attempt — fall through to retry */
        }
        if (result) return result
        if (i < maxAttempts - 1) {
          await sleep(delay)
          delay = Math.min(delay * 2, 10_000)
        }
      }
      return null // sustained failure well past a normal blip — genuinely give up
    }

    // Queue behind whatever wave is still being retried, so two clears for the same
    // run are never in flight at once and always land in order.
    const run = queueRef.current.then(withRetries, withRetries)
    queueRef.current = run
    return run
  }, [seasonId, reopenSession])

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
