import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { usePlayerStore } from '@/stores/usePlayerStore'
import type { Player } from '@/types'

// Subscribes to real-time Supabase changes for the connected player.
// Updates the global store automatically when XP, rank, or decay changes.
export function useRealtimePlayer(walletAddress: string | undefined) {
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)

  useEffect(() => {
    if (!walletAddress) return

    const channel = supabase
      .channel(`realtime:player:${walletAddress}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'players',
          filter: `wallet_address=eq.${walletAddress}`,
        },
        (payload) => {
          updatePlayer(payload.new as Partial<Player>)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [walletAddress, updatePlayer])
}
