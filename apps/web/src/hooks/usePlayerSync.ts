import { useEffect } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export function usePlayerSync(address: string | undefined) {
  const { setPlayer, setInventory, clearPlayer, setPlayerSynced } = usePlayerStore()

  useEffect(() => {
    if (!address) {
      clearPlayer()
      return
    }

    async function sync() {
      const [playerRes, inventoryRes] = await Promise.all([
        fetch(`${API}/players/${address}`),
        fetch(`${API}/players/${address}/inventory`),
      ])

      if (playerRes.ok) {
        const player = await playerRes.json()
        setPlayer(player)
      }

      if (inventoryRes.ok) {
        const inventory = await inventoryRes.json()
        setInventory(inventory ?? [])
      }

      // Mark sync complete regardless of whether a player record was found.
      // HomePage waits for this before deciding to redirect to /onboarding.
      setPlayerSynced(true)
    }

    sync()
  }, [address, setPlayer, setInventory, clearPlayer, setPlayerSynced])
}
