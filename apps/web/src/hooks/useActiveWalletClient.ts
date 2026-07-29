'use client'

import { useMemo } from 'react'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { celo } from 'viem/chains'
import { useWalletClient as useWagmiWalletClient } from 'wagmi'
import { getBridgedProviderFor, type BridgeEntry } from '@/lib/walletBridge'
import { getMagic } from '@/lib/magic'
import { useResolvedAuth } from './useResolvedAuth'

// The one seam every signing path goes through. Returns a viem WalletClient for
// the session's address, or undefined when nothing can sign for it.
//
// SELECTION IS BY ADDRESS, NOT BY PRECEDENCE. This used to try providers in a
// fixed order and then reject the winner if its address was wrong — which meant
// a leftover session from one SDK sat in front of the correct provider from
// another and turned into a permanent "wallet can't sign". Connect MetaMask
// while a half-finished Web3Auth session is still in the bridge and the app
// would refuse to sign with the wallet you just connected.
//
// Asking "which provider IS this address?" instead of "which provider comes
// first?" removes that failure entirely: a stale entry for a different address
// can no longer mask a live one, and a provider for the wrong address can never
// be returned, because matching the session address is the selection criterion
// rather than an afterthought.
export function useActiveWalletClient(): WalletClient | undefined {
  const { status, address, source } = useResolvedAuth()
  const { data: wagmiWalletClient } = useWagmiWalletClient()

  return useMemo(() => {
    if (status !== 'ready' || !address) return undefined
    const want = address.toLowerCase()

    const fromBridge = (entry: BridgeEntry | null): WalletClient | undefined => {
      if (!entry || entry.address.toLowerCase() !== want) return undefined
      return createWalletClient({
        account: entry.address,
        chain: celo,
        transport: custom(entry.provider),
      })
    }

    // 1. An external wallet held by wagmi's own connector (desktop extension, or
    //    a wallet's in-app browser). Preferred when it is genuinely this address.
    if (wagmiWalletClient?.account?.address?.toLowerCase() === want) {
      return wagmiWalletClient
    }

    // 2. Magic's published provider, if it owns this address.
    const matched = fromBridge(getBridgedProviderFor('magic'))
    if (matched) return matched

    // 3. Magic's SDK singleton. Its provider is available synchronously, so a
    //    Magic session must never be stranded merely because the bridge has not
    //    published yet — that gap is what stranded mobile and PWA users on
    //    "Wallet session not ready". Restricted to a Magic session: building a
    //    client with an external wallet's address on Magic's transport would
    //    sign with Magic's key while claiming the wallet's address, producing a
    //    permit the backend cannot match to the buyer.
    if (source === 'magic') {
      const magic = getMagic()
      if (magic) {
        return createWalletClient({
          account: address,
          chain: celo,
          transport: custom(magic.rpcProvider),
        })
      }
    }

    return undefined
  }, [status, address, source, wagmiWalletClient])
}
