'use client'

import { useAccount } from 'wagmi'
import { useMagicAuthContext, type ResolvedAuthStatus } from '@/components/providers/MagicAuthProvider'

export type { ResolvedAuthStatus }
export type AuthSource = 'magic' | 'wallet'

// Every page reads auth through this hook — it's the one seam that decides what
// "signed in" means. Two kinds of session feed it:
//
//  • 'magic'  — Valor's own embedded wallet, from email or Google. The only
//               path that MINTS an address, so it stays the sole owner of
//               player identity.
//  • 'wallet' — an external wallet the player already owned, connected through
//               wagmi's own connectors (injected, or WalletConnect for mobile).
//               There is exactly one route now: a second SDK also claiming this
//               source is what let one session mask another's signer.
//
// Magic wins if both are somehow live: it's the account the player's rank,
// items and G$ hang off.
export function useResolvedAuth() {
  const magic = useMagicAuthContext()
  const { address: walletAddress, isConnected } = useAccount()

  if (magic.status === 'ready' && magic.address) {
    // magicEmail/magicIssuer let us store the login identity per wallet, which
    // is how we detect one person holding several addresses.
    return {
      status: 'ready' as const,
      address: magic.address,
      source: 'magic' as AuthSource,
      magicEmail: magic.email,
      magicIssuer: magic.issuer,
    }
  }
  if (isConnected && walletAddress) {
    return {
      status: 'ready' as const,
      address: walletAddress,
      source: 'wallet' as AuthSource,
      magicEmail: undefined,
      magicIssuer: undefined,
    }
  }
  if (magic.status === 'loading') {
    return {
      status: 'loading' as const,
      address: undefined,
      source: undefined,
      magicEmail: undefined,
      magicIssuer: undefined,
    }
  }
  return {
    status: 'unauthenticated' as const,
    address: undefined,
    source: undefined,
    magicEmail: undefined,
    magicIssuer: undefined,
  }
}
