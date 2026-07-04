'use client'

import { useEffect } from 'react'
import { useDisconnect } from 'wagmi'
import { useWeb3Auth } from '@web3auth/modal/react'
import { useQueryClient } from '@tanstack/react-query'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useValorAuth } from '@/hooks/useValorAuth'
import { usePlayerSync } from '@/hooks/usePlayerSync'
import { useRealtimePlayer } from '@/hooks/useRealtimePlayer'
import { useDecayMonitor } from '@/hooks/useDecayMonitor'
import { useWalletBridgeGuard } from '@/hooks/useWalletBridgeGuard'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useGLTF } from '@react-three/drei'
import { CHARACTER_GLB } from '@/lib/classes'

// Fire-and-forget: preload all 3 character GLBs immediately so they're
// ready by the time the player reaches character select or battle screens.
Object.values(CHARACTER_GLB).forEach(path => useGLTF.preload(path))

export default function AppInit() {
  const { isInitialized: ready, isConnected: authenticated } = useWeb3Auth()
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
  useWalletBridgeGuard()
  // Ground-truth address from Web3Auth directly (via useWalletBridgeGuard),
  // NOT wagmi's — player sync must not wait on wagmi's bridge to catch up.
  const { address } = useResolvedAuth()
  usePlayerSync(address)
  useRealtimePlayer(address)
  useDecayMonitor()
  return null
}
