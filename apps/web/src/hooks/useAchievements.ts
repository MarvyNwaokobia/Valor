import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface NewAchievement {
  achievement_id: string
  achievement_name: string
  unlocked_at: string
}

/**
 * Returns a `checkAchievements(walletAddress)` function.
 * Call it after any event that could unlock something:
 *   - battle end (wins, rank-up)
 *   - mission collect (missions >= 10, inventory)
 *   - item purchase (inventory >= 5)
 *   - decay recovery (handled separately via checkDecayRecovery)
 *
 * Newly unlocked achievements are returned and the achievements cache is invalidated
 * so the player card badge updates immediately.
 */
export function useAchievements() {
  const queryClient = useQueryClient()

  const checkAchievements = useCallback(
    async (walletAddress: string): Promise<NewAchievement[]> => {
      const { data, error } = await supabase.rpc('check_and_unlock_achievements', {
        p_wallet: walletAddress,
      })

      if (error) {
        console.error('[achievements] check failed:', error.message)
        return []
      }

      const newUnlocks = (data ?? []) as NewAchievement[]

      if (newUnlocks.length > 0) {
        // Invalidate so AchievementSlots re-fetches the updated list
        queryClient.invalidateQueries({ queryKey: ['achievements', walletAddress] })
      }

      return newUnlocks
    },
    [queryClient],
  )

  /**
   * Award the Survivor achievement when a player recovers from active decay.
   * Called explicitly when we detect the decay_status transition active → none.
   */
  const checkDecayRecovery = useCallback(
    async (walletAddress: string) => {
      // Fetch the Survivor achievement id
      const { data: achievementRow } = await supabase
        .from('achievements')
        .select('id')
        .eq('condition', 'decay_recovered')
        .single()

      if (!achievementRow) return

      await supabase
        .from('player_achievements')
        .upsert(
          {
            wallet_address: walletAddress,
            achievement_id: achievementRow.id,
            unlocked_at: new Date().toISOString(),
          },
          { onConflict: 'wallet_address,achievement_id', ignoreDuplicates: true },
        )

      queryClient.invalidateQueries({ queryKey: ['achievements', walletAddress] })
    },
    [queryClient],
  )

  return { checkAchievements, checkDecayRecovery }
}
