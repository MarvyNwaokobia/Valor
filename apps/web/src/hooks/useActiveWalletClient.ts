'use client'

import { useMemo } from 'react'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { activeChain } from '@/editions/chain'
import { useWalletClient as useWagmiWalletClient } from 'wagmi'
import { getBridgedProvider } from '@/lib/walletBridge'
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
    if (!bridged) return undefined
    // The bridge publishes provider and address together, so the account here
    // can never drift from the session the provider will actually sign with.
    return createWalletClient({
      account: bridged.address,
      chain: activeChain(),
      transport: custom(bridged.provider),
    })
  }, [status, address, source, wagmiWalletClient])
}

/**
 * Why `useActiveWalletClient()` returned `undefined` on the wagmi path, when it
 * did. wagmi's own `useWalletClient()` swallows its query error into a plain
 * `undefined` `data`, which is what let "wallet session not ready" go unexplained
 * on mobile for as long as it did — every prior theory about *why* had nothing
 * concrete to check against. This exists purely so the next repro produces an
 * actual error message instead of another guess.
 *
 * Only meaningful for `source === 'wallet'` (wagmi's injected connector) — the
 * bridge path (Magic, Web3Auth) never touches this query, so it has nothing to
 * report there.
 */
export function useActiveWalletClientError(): Error | null {
  const { source } = useResolvedAuth()
  const { error } = useWagmiWalletClient()
  if (source !== 'wallet' || !error) return null
  return error instanceof Error ? error : new Error(String(error))
}
