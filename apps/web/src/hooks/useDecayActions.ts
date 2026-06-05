import { useMutation } from '@tanstack/react-query'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { DECAY_FREEZE_DAYS } from '@/lib/constants'
import type { Rank } from '@/types/database'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

// Protection Shield: freeze decay for 7 days
export function useFreezeDecay(walletAddress: string) {
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)

  return useMutation({
    mutationFn: async () => {
      const freezeUntil = new Date(Date.now() + DECAY_FREEZE_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const res = await fetch(`${API}/players/${walletAddress}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decay_frozen_until: freezeUntil, decay_status: 'none' }),
      })
      if (!res.ok) throw new Error('Failed to freeze decay')
      return freezeUntil
    },
    onSuccess: (freezeUntil) => {
      updatePlayer({ decay_frozen_until: freezeUntil, decay_status: 'none' })
    },
  })
}

// Resurrection Scroll: restore one lost rank level
export function useResurrect(walletAddress: string) {
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)
  const player = usePlayerStore((s) => s.player)

  return useMutation({
    mutationFn: async () => {
      if (!player) throw new Error('No player')

      const rankOrder = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'] as const
      const idx = rankOrder.indexOf(player.rank as (typeof rankOrder)[number])
      const restoredRank = idx < rankOrder.length - 1 ? rankOrder[idx + 1] : player.rank

      const res = await fetch(`${API}/players/${walletAddress}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          rank:         restoredRank,
          decay_status: 'none',
          last_active:  new Date().toISOString(),
        }),
      })
      if (!res.ok) throw new Error('Failed to resurrect')
      return restoredRank
    },
    onSuccess: (restoredRank) => {
      updatePlayer({
        rank:         restoredRank as Rank,
        decay_status: 'none',
        last_active:  new Date().toISOString(),
      })
    },
  })
}
