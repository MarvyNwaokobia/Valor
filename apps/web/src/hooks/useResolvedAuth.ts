'use client'

import { useAccount } from 'wagmi'
import { useMagicAuthContext, type ResolvedAuthStatus } from '@/components/providers/MagicAuthProvider'
import { useWeb3AuthWallet } from '@/components/providers/Web3AuthSessionProvider'
import { isWeb3AuthConfigured } from '@/lib/web3authConfig'

export type { ResolvedAuthStatus }
export type AuthSource = 'magic' | 'wallet'

// Every page reads auth through this hook — it's the one seam that decides what
// "signed in" means. Two kinds of session feed it:
//
//  • 'magic'  — Valor's own embedded wallet, from email or Google. The only
//               path that MINTS an address, so it stays the sole owner of
//               player identity.
//  • 'wallet' — an external wallet the player already owned, connected either
//               through wagmi's injected connector or through Web3Auth's wallet
//               chooser. Both end at the same place; which one carried the
//               connection is an implementation detail, so they share a source.
//
// Magic wins if both are somehow live: it's the account the player's rank,
// items and G$ hang off.
export function useResolvedAuth() {
  const magic = useMagicAuthContext()
  const web3authWallet = useWeb3AuthWallet()
  const { address: walletAddress, isConnected, status: wagmiStatus } = useAccount()

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
  if (web3authWallet.address) {
    return {
      status: 'ready' as const,
      address: web3authWallet.address,
      source: 'wallet' as AuthSource,
      magicEmail: undefined,
      magicIssuer: undefined,
    }
  }
  // None of the three sources has produced an address yet. Before calling that
  // "signed out", make sure every source actually got the chance to say so — on
  // a hard reload wagmi's injected connector and Web3Auth's SDK both restore
  // their session asynchronously, and Magic (which has no session for a
  // wallet-only player) tends to resolve first. Falling through to
  // 'unauthenticated' the instant Magic settles bounced wallet-connected
  // players to the landing page mid-reconnect.
  const wagmiStillResolving = wagmiStatus === 'connecting' || wagmiStatus === 'reconnecting'
  const web3authStillBooting = isWeb3AuthConfigured && !web3authWallet.isReady
  if (magic.status === 'loading' || wagmiStillResolving || web3authStillBooting) {
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
