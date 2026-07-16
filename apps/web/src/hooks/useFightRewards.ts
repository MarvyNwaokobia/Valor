import { useCallback, useRef, useState } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useAchievements } from '@/hooks/useAchievements'
import type { Player } from '@/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface FightReward {
  won:           boolean
  xpAwarded:     number
  newXp:         number
  rankedUp:      boolean
  newRank:       Player['rank'] | null
  gAwarded:      number
  bountyAwarded: number  // one-time first-clear G$ bounty (0 unless a new op cleared)
  firstClear:    boolean
}

/**
 * Records a finished real-time fight with the server, which is authoritative over
 * all rewards — the client only reports whether it won and how long the fight ran.
 * Mirrors the turn-based `useBattle` finalize: applies XP/rank/G$ to the player
 * store and fires achievement + decay-recovery checks. This is what moves the
 * earn loop onto the live fighter so the turn-based "Classic" mode can retire.
 */
export function useFightRewards() {
  const player       = usePlayerStore((s) => s.player)
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)
  const { checkAchievements, checkDecayRecovery } = useAchievements()

  const [reward,  setReward]  = useState<FightReward | null>(null)
  const [pending, setPending] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // The server-issued fight token for the current run. Obtained at fight START via
  // startFight() and consumed by submitResult(). Campaign rewards (XP / first-clear
  // G$ / pve advance) are only granted when a valid token backs the completion, so
  // the client can no longer forge an outcome or skip ops.
  const sessionIdRef = useRef<string | null>(null)

  // Open a server-authoritative fight session. Call this when a fight BEGINS. For a
  // Campaign op pass its 1-based level; the server enforces sequential unlock and
  // records the real start time. A failure here (offline) just leaves no token —
  // submitResult then falls back to the flat, no-reward-money path.
  const startFight = useCallback(
    async (level?: number): Promise<void> => {
      if (!player) return
      sessionIdRef.current = null
      try {
        const res = await fetch(`${API}/battles/fight/start`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ wallet: player.wallet_address, level }),
        })
        if (res.ok) {
          const data = await res.json()
          sessionIdRef.current = data.session_id ?? null
        }
      } catch {
        /* offline — no token; submitResult handles the absence gracefully */
      }
    },
    [player]
  )

  const submitResult = useCallback(
    async (won: boolean): Promise<FightReward | null> => {
      if (!player) return null
      const wallet = player.wallet_address

      // Consume the token (single-use). Its presence marks this as a Campaign run;
      // its absence a flat, non-Campaign fight (Endless) that can never earn G$.
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null

      setPending(true)
      setError(null)
      try {
        const res = await fetch(`${API}/battles/fight/complete`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(sessionId ? { session_id: sessionId, won } : { won, wallet }),
        })

        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error((e as { error?: string }).error ?? `API error ${res.status}`)
        }

        const data = await res.json()

        // ── Sync the player store from the server's authoritative result ──
        // B0: ranking up is pure progression (no G$); G$ now comes from the
        // one-time first-clear bounty, which is what bumps the lifetime stat.
        const bountyAwarded: number = data.bounty_awarded ?? 0
        const storeUpdates: Partial<Player> = {
          xp:           data.new_xp,
          wins:         won ? player.wins + 1 : player.wins,
          losses:       won ? player.losses : player.losses + 1,
          decay_status: 'none',
        }
        if (data.ranked_up && data.new_rank) {
          storeUpdates.rank = data.new_rank
        }
        if (bountyAwarded > 0) {
          storeUpdates.g_earned_lifetime = (player.g_earned_lifetime ?? 0) + bountyAwarded
        }
        if (data.first_clear && data.level) {
          storeUpdates.pve_level = Math.max(player.pve_level ?? 0, data.level)
        }
        updatePlayer(storeUpdates)

        // ── Fire-and-forget side effects ─────────────────────────────────
        if (player.decay_status === 'active') {
          checkDecayRecovery(wallet).catch(console.error)
        }
        checkAchievements(wallet).catch(console.error)

        const result: FightReward = {
          won,
          xpAwarded:     data.xp_awarded,
          newXp:         data.new_xp,
          rankedUp:      data.ranked_up,
          newRank:       data.new_rank ?? null,
          gAwarded:      data.g_awarded,
          bountyAwarded,
          firstClear:    data.first_clear ?? false,
        }
        setReward(result)
        return result
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to record fight')
        return null
      } finally {
        setPending(false)
      }
    },
    [player, updatePlayer, checkAchievements, checkDecayRecovery]
  )

  return { startFight, submitResult, reward, pending, error }
}
