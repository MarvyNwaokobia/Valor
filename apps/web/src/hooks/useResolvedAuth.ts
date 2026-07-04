'use client'

import { useWeb3Auth } from '@web3auth/modal/react'
import { useWalletBridgeStore } from '@/stores/useWalletBridgeStore'

export type ResolvedAuthStatus = 'initializing' | 'unauthenticated' | 'resolving' | 'ready' | 'stalled'

// The single source of truth for "is this user logged in, and what's their
// address" — every page should read this instead of combining
// useWeb3Auth().isConnected with wagmi's useAccount().address directly.
// The actual resolution work (polling Web3Auth's own provider, since
// wagmi's bridge can race — see useWalletBridgeGuard) runs once, in
// AppInit; this hook only reads its result.
export function useResolvedAuth() {
  const { isInitialized, isConnected } = useWeb3Auth()
  const bridgeStatus = useWalletBridgeStore((s) => s.status)
  const bridgeAddress = useWalletBridgeStore((s) => s.address)
  const diagnostic = useWalletBridgeStore((s) => s.diagnostic)

  let status: ResolvedAuthStatus
  if (!isInitialized) status = 'initializing'
  else if (!isConnected) status = 'unauthenticated'
  else if (bridgeAddress) status = 'ready'
  else if (bridgeStatus === 'stalled') status = 'stalled'
  else status = 'resolving'

  return {
    status,
    address: status === 'ready' ? bridgeAddress : undefined,
    diagnostic,
  }
}
