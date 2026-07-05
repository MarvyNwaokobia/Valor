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
    if (status !== 'ready' || !address) return undefined
    if (source === 'wallet') return wagmiWalletClient
    const magic = getMagic()
    if (!magic) return undefined
    return createWalletClient({
      account: address,
      chain: celo,
      transport: custom(magic.rpcProvider),
    })
  }, [status, address, source, wagmiWalletClient])
}
