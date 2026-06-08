import { useEffect } from 'react'
import { usePlayerStore } from '@/stores/usePlayerStore'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export function usePlayerSync(address: string | undefined) {
  const { setPlayer, setInventory, clearPlayer, setPlayerSynced, setVerified, setProfileExists } = usePlayerStore()

  useEffect(() => {
    if (!address) {
      clearPlayer()
      return
    }

    const wallet = address // narrowed to string, safe to capture in closure

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
            // A player record in the DB means verification was completed.
            setVerified(true)
            // Persist per-wallet so routing works even if the API is temporarily down.
            setProfileExists(wallet, true)
          }
        }

        if (inventoryRes.ok) {
          const inventory = await inventoryRes.json()
          setInventory(inventory ?? [])
        }
      } catch {
        // Network or parse error — don't crash, just mark sync done so
        // routing guards can still use the persisted profileExists flag.
      } finally {
        // Mark sync complete regardless of outcome.
        // HomePage waits for this before deciding to redirect to /onboarding.
        setPlayerSynced(true)
      }
    }

    sync()
  }, [address, setPlayer, setInventory, clearPlayer, setPlayerSynced, setVerified, setProfileExists])
}
