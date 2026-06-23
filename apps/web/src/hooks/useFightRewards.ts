import { useCallback, useState } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useAchievements } from '@/hooks/useAchievements'
import type { Player } from '@/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface FightReward {
  won:       boolean
  xpAwarded: number
  newXp:     number
  rankedUp:  boolean
  newRank:   Player['rank'] | null
  gAwarded:  number
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

  const submitResult = useCallback(
    async (won: boolean, durationSecs: number): Promise<FightReward | null> => {
      if (!player) return null
      const wallet = player.wallet_address

      setPending(true)
      setError(null)
      try {
        const res = await fetch(`${API}/battles/fight/complete`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ wallet, won, duration_secs: durationSecs }),
        })

        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error((e as { error?: string }).error ?? `API error ${res.status}`)
        }

        const data = await res.json()

        // ── Sync the player store from the server's authoritative result ──
        const storeUpdates: Partial<Player> = {
          xp:           data.new_xp,
          wins:         won ? player.wins + 1 : player.wins,
          losses:       won ? player.losses : player.losses + 1,
          decay_status: 'none',
        }
        if (data.ranked_up && data.new_rank) {
          storeUpdates.rank              = data.new_rank
          storeUpdates.g_earned_lifetime = player.g_earned_lifetime + data.g_awarded
        }
        updatePlayer(storeUpdates)

        // ── Fire-and-forget side effects ─────────────────────────────────
        if (player.decay_status === 'active') {
          checkDecayRecovery(wallet).catch(console.error)
        }
        checkAchievements(wallet).catch(console.error)

        const result: FightReward = {
          won,
          xpAwarded: data.xp_awarded,
          newXp:     data.new_xp,
          rankedUp:  data.ranked_up,
          newRank:   data.new_rank ?? null,
          gAwarded:  data.g_awarded,
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

  return { submitResult, reward, pending, error }
}
