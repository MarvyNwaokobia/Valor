'use client'

import { useAccount } from 'wagmi'
import { useMagicAuthContext, type ResolvedAuthStatus } from '@/components/providers/MagicAuthProvider'

export type { ResolvedAuthStatus }
export type AuthSource = 'magic' | 'wallet'

// Every page reads auth through this hook — it's the one seam that decides
// what "signed in" means. Two independent paths feed it: Magic's embedded
// wallet (email/Google) and a directly-connected external wallet (MetaMask/
// WalletConnect, via wagmi's own connectors — see wagmi.ts for why that's
// safe here). Magic wins if both are somehow active at once.
export function useResolvedAuth() {
  const magic = useMagicAuthContext()
  const { address: walletAddress, isConnected } = useAccount()

  if (magic.status === 'ready' && magic.address) {
    // magicEmail/magicIssuer let us store the login identity per wallet (multi-account detection).
    return { status: 'ready' as const, address: magic.address, source: 'magic' as AuthSource, magicEmail: magic.email, magicIssuer: magic.issuer }
  }
  if (isConnected && walletAddress) {
    return { status: 'ready' as const, address: walletAddress, source: 'wallet' as AuthSource, magicEmail: undefined, magicIssuer: undefined }
  }
  if (magic.status === 'loading') {
    return { status: 'loading' as const, address: undefined, source: undefined, magicEmail: undefined, magicIssuer: undefined }
  }
  return { status: 'unauthenticated' as const, address: undefined, source: undefined, magicEmail: undefined, magicIssuer: undefined }
}
