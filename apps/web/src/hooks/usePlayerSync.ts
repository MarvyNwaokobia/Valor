import { useEffect } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export function usePlayerSync(address: string | undefined) {
  const { setPlayer, setInventory, clearPlayer, setPlayerSynced, setVerified, setSyncFailed } = usePlayerStore()

  useEffect(() => {
    if (!address) {
      clearPlayer()
      return
    }

    // Always lowercase — wagmi returns EIP-55 checksummed addresses but
    // the DB stores them normalized (lowercase) via normalize_wallet on the backend.
    const wallet = address.toLowerCase()

    async function sync() {
      try {
        const [playerRes, inventoryRes] = await Promise.all([
          fetch(`${API}/players/${wallet}`),
          fetch(`${API}/players/${wallet}/inventory`),
        ])

        if (playerRes.ok) {
          const player = await playerRes.json()
          if (player) {
            setPlayer(player)
            setVerified(true)
          }
        }

        if (inventoryRes.ok) {
          const inventory = await inventoryRes.json()
          setInventory(inventory ?? [])
        }

        setSyncFailed(false)
      } catch {
        // Network error — mark failure so the UI can show a retry prompt.
        setSyncFailed(true)
      } finally {
        setPlayerSynced(true)
      }
    }

    sync()
  }, [address, setPlayer, setInventory, clearPlayer, setPlayerSynced, setVerified, setSyncFailed])
}
