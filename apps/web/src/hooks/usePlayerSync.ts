import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { usePlayerStore } from '@/stores/usePlayerStore'

export function usePlayerSync(address: string | undefined) {
  const { setPlayer, setInventory, clearPlayer } = usePlayerStore()

  useEffect(() => {
    if (!address) {
      clearPlayer()
      return
    }

    let playerSub: ReturnType<typeof supabase.channel> | null = null

    async function sync() {
      const { data: player } = await supabase
        .from('players')
        .select('*')
        .eq('wallet_address', address)
        .single()

      if (player) {
        setPlayer(player)

        const { data: inventory } = await supabase
          .from('inventory')
          .select('*')
          .eq('wallet_address', address)

        setInventory(inventory ?? [])

        // Subscribe to real-time player updates
        playerSub = supabase
          .channel(`player:${address}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'players', filter: `wallet_address=eq.${address}` },
            (payload) => setPlayer(payload.new as typeof player),
          )
          .subscribe()
      }
    }

    sync()

    return () => {
      playerSub?.unsubscribe()
    }
  }, [address, setPlayer, setInventory, clearPlayer])
}
