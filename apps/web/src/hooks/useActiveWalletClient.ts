'use client'

import { useMemo } from 'react'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { celo } from 'viem/chains'
import { useWalletClient as useWagmiWalletClient } from 'wagmi'
import { getMagic } from '@/lib/magic'
import { useResolvedAuth } from './useResolvedAuth'

// A plain viem WalletClient for whichever auth path is active.
// - Magic path: built directly from magic.rpcProvider — deliberately NOT a
//   wagmi connector (see wagmi.ts / MagicAuthProvider for why).
// - Wallet path: wagmi's own useWalletClient. Safe to use here — it's
//   wagmi's native connector talking directly to the wallet, not a shim
//   bridging a third-party SDK's separate state.
export function useActiveWalletClient(): WalletClient | undefined {
  const { status, address, source } = useResolvedAuth()
  const { data: wagmiWalletClient } = useWagmiWalletClient()

  return useMemo(() => {
    console.log('[ActiveWalletClient] resolving. status:', status, 'address:', address, 'source:', source)
    if (status !== 'ready' || !address) {
      console.warn('[ActiveWalletClient] not ready or no address — returning undefined')
      return undefined
    }
    if (source === 'wallet') return wagmiWalletClient
    const magic = getMagic()
    if (!magic) {
      console.warn('[ActiveWalletClient] source is magic but getMagic() returned null — returning undefined')
      return undefined
    }
    console.log('[ActiveWalletClient] built Magic-backed walletClient')
    return createWalletClient({
      account: address,
      chain: celo,
      transport: custom(magic.rpcProvider),
    })
  }, [status, address, source, wagmiWalletClient])
}
