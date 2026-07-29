'use client'

import { useDisconnect } from 'wagmi'
import { useMagicAuthContext } from '@/components/providers/MagicAuthProvider'
import { useWeb3AuthWallet } from '@/components/providers/Web3AuthSessionProvider'
import { useResolvedAuth } from './useResolvedAuth'
import { usePlayerStore } from '@/stores/usePlayerStore'

// Signs out through whichever path is active — Magic's logout for the
// embedded-wallet path, wagmi's disconnect for a connected external wallet — then
// ALWAYS lands on the Valor landing page ('/'), signed out, ready to sign in again.
//
// The hard navigation (window.location, not router.push) is deliberate: it fully
// tears down the app so no authenticated page (Profile / Bank / Marketplace) is
// left mounted without a session. That half-torn-down state — the current page
// re-rendering with a null player right after logout — was what threw the
// "application error" when you signed out from anywhere but Home.
export function useSignOut() {
  const { source } = useResolvedAuth()
  const { logout } = useMagicAuthContext()
  const { disconnect } = useDisconnect()
  const { disconnect: disconnectWeb3Auth } = useWeb3AuthWallet()
  const clearPlayer = usePlayerStore((s) => s.clearPlayer)

  return async () => {
    try {
      if (source === 'wallet') {
        // BOTH, unconditionally. An external wallet can be held by wagmi or by
        // Web3Auth and `source` does not say which, so signing out used to call
        // wagmi's disconnect only — leaving a Web3Auth session alive, which the
        // SDK restores on the very next page load. The player pressed sign out,
        // landed on the landing page, and was signed straight back in. Each call
        // is a no-op for a session that isn't there, so asking both is free.
        disconnect()
        await disconnectWeb3Auth()
      } else {
        await logout()
      }
    } catch {
      // Sign out locally + redirect regardless of provider errors.
    } finally {
      clearPlayer() // reset the cached player/inventory so '/' shows the signed-out landing
      if (typeof window !== 'undefined') window.location.assign('/')
    }
  }
}
