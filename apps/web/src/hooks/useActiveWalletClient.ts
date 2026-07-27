'use client'

import { useMemo } from 'react'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { celo } from 'viem/chains'
import { useWalletClient as useWagmiWalletClient } from 'wagmi'
import { getBridgedProvider } from '@/lib/walletBridge'
import { getMagic } from '@/lib/magic'
import { useResolvedAuth } from './useResolvedAuth'

// The one seam every signing path goes through. Returns a plain viem
// WalletClient for whichever auth path is active, so call sites can use
// signTypedData / writeContract / signMessage without knowing or caring which
// SDK is behind the wallet.
//
// - External wallet via wagmi's injected connector: wagmi's own
//   useWalletClient. Safe because it's wagmi's native connector talking
//   straight to the wallet.
// - Anything else: built from whatever provider is published to
//   lib/walletBridge — Magic's embedded wallet, or an external wallet connected
//   through Web3Auth's chooser (wagmi registers no connector for that one, so
//   it can only be reached through the bridge).
//
// Adding another SDK later means publishing to the bridge from its provider
// component; this hook and all ten of its call sites stay untouched.
export function useActiveWalletClient(): WalletClient | undefined {
  const { status, address, source } = useResolvedAuth()
  const { data: wagmiWalletClient } = useWagmiWalletClient()

  return useMemo(() => {
    if (status !== 'ready' || !address) return undefined
    // A 'wallet' source is wagmi's only when wagmi actually holds the
    // connection; a Web3Auth-connected wallet reports the same source but falls
    // through to the bridge below.
    if (source === 'wallet' && wagmiWalletClient) return wagmiWalletClient

    const bridged = getBridgedProvider()
    if (!bridged) {
      // Fall back to building straight off Magic. This is what the hook did
      // before the bridge existed, and dropping it was a regression: the bridge
      // is populated by MagicAuthProvider, so ANY reason it hasn't published —
      // ordering, a cleared session, a remount — turned "signed in" into "cannot
      // sign at all", which is what stranded mobile/PWA users on
      // "Wallet session not ready".
      //
      // Magic's provider is available synchronously from the SDK singleton, so
      // there is no reason to need the bridge for it. The bridge stays for
      // Web3Auth-connected wallets, which have no other route.
      const magic = getMagic()
      if (!magic) return undefined
      return createWalletClient({
        account: address,
        chain: celo,
        transport: custom(magic.rpcProvider),
      })
    }
    // The bridge publishes provider and address together, so the account here
    // can never drift from the session the provider will actually sign with.
    return createWalletClient({
      account: bridged.address,
      chain: celo,
      transport: custom(bridged.provider),
    })
  }, [status, address, source, wagmiWalletClient])
}
