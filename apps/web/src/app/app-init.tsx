'use client'

import { useEffect } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { usePrivy } from '@privy-io/react-auth'
import { useQueryClient } from '@tanstack/react-query'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useValorAuth } from '@/hooks/useValorAuth'
import { usePlayerSync } from '@/hooks/usePlayerSync'
import { useRealtimePlayer } from '@/hooks/useRealtimePlayer'
import { useDecayMonitor } from '@/hooks/useDecayMonitor'
import { useGLTF } from '@react-three/drei'
import { CHARACTER_GLB } from '@/lib/classes'

// Fire-and-forget: preload all 3 character GLBs immediately so they're
// ready by the time the player reaches character select or battle screens.
Object.values(CHARACTER_GLB).forEach(path => useGLTF.preload(path))

export default function AppInit() {
  const { ready, authenticated } = usePrivy()
  const { address } = useAccount()
  const { disconnect } = useDisconnect()
  const clearPlayer = usePlayerStore(s => s.clearPlayer)
  const queryClient = useQueryClient()

  // Handle clean sign-out: clear wagmi address, Zustand state, and React Query cache
  useEffect(() => {
    if (ready && !authenticated) {
      disconnect()
      clearPlayer()
      queryClient.clear()
    }
  }, [ready, authenticated, disconnect, clearPlayer, queryClient])

  useValorAuth()
  usePlayerSync(address)
  useRealtimePlayer(address)
  useDecayMonitor()
  return null
}
