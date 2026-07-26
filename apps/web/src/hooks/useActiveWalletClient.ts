'use client'

import { useMemo } from 'react'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { celo } from 'viem/chains'
import { useWalletClient as useWagmiWalletClient } from 'wagmi'
import { getBridgedProvider } from '@/lib/walletBridge'
import { useResolvedAuth } from './useResolvedAuth'

// The one seam every signing path goes through. Returns a plain viem
// WalletClient for whichever auth path is active, so call sites can use
// signTypedData / writeContract / signMessage without knowing or caring which
// SDK is behind the wallet.
//
// - External wallet: wagmi's own useWalletClient. Safe because it's wagmi's
//   native connector talking straight to the wallet.
// - Embedded wallet: built from whatever provider is published to
//   lib/walletBridge (Magic today). Adding a second embedded-wallet SDK means
//   publishing to the bridge from its provider component; this hook and all ten
//   of its call sites stay untouched.
export function useActiveWalletClient(): WalletClient | undefined {
  const { status, address, source } = useResolvedAuth()
  const { data: wagmiWalletClient } = useWagmiWalletClient()

  return useMemo(() => {
    if (status !== 'ready' || !address) return undefined
    if (source === 'wallet') return wagmiWalletClient

    const bridged = getBridgedProvider()
    if (!bridged) return undefined
    // The bridge publishes provider and address together, so the account here
    // can never drift from the session the provider will actually sign with.
    return createWalletClient({
      account: bridged.address,
      chain: celo,
      transport: custom(bridged.provider),
    })
  }, [status, address, source, wagmiWalletClient])
}
