import { useEffect } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
const TIMEOUT_MS = 10_000

function fetchWithTimeout(url: string, signal: AbortSignal) {
  return fetch(url, { signal })
}

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
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    async function sync() {
      try {
        const [playerRes, inventoryRes] = await Promise.all([
          fetchWithTimeout(`${API}/players/${wallet}`, controller.signal),
          fetchWithTimeout(`${API}/players/${wallet}/inventory`, controller.signal),
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
        setSyncFailed(true)
      } finally {
        clearTimeout(timeoutId)
        setPlayerSynced(true)
      }
    }

    sync()

    return () => {
      controller.abort()
      clearTimeout(timeoutId)
    }
  }, [address, setPlayer, setInventory, clearPlayer, setPlayerSynced, setVerified, setSyncFailed])
}
