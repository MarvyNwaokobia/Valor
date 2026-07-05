'use client'

import { useDisconnect } from 'wagmi'
import { useMagicAuthContext } from '@/components/providers/MagicAuthProvider'
import { useResolvedAuth } from './useResolvedAuth'

// Signs out through whichever path is active — Magic's logout for the
// embedded-wallet path, wagmi's disconnect for a connected external wallet.
export function useSignOut() {
  const { source } = useResolvedAuth()
  const { logout } = useMagicAuthContext()
  const { disconnect } = useDisconnect()

  return async () => {
    if (source === 'wallet') disconnect()
    else await logout()
  }
}
