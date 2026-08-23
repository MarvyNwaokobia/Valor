'use client'

import { useEffect } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { activeChainId } from '@/editions/chain'

/**
 * Nothing in the connect flow ever asked an external wallet to actually be on
 * Celo, so wagmi recorded a connection's chain as whatever the wallet happened
 * to be on at connect time. A wallet that drifted off Celo afterwards — or a
 * fresh MetaMask install, which defaults to Ethereum Mainnet — left wagmi's own
 * `useWalletClient()` permanently throwing `ConnectorChainMismatchError`
 * ("current chain (id: 1) does not match connection's chain (id: 42220)"),
 * invisible to the player as a plain "wallet session not ready".
 *
 * `useAccount()`/`useChainId()` only ever reflect wagmi's own injected
 * connector — Magic and Web3Auth-connected wallets register no wagmi connector
 * at all (see useActiveWalletClient.ts), so `isConnected` here is false for
 * both and this never touches either of those paths.
 *
 * Mounted once from AppInit, not per call site: firing this from every
 * `useActiveWalletClient()` caller would mean N concurrent switchChain calls
 * racing each other on the same page.
 */
export function useEnsureActiveChain() {
  const { isConnected, connector } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const target = activeChainId()

  useEffect(() => {
    if (!isConnected || !connector || chainId === target) return
    // The connector's own switchChain falls back to wallet_addEthereumChain
    // automatically when the wallet doesn't recognise the chain yet — nothing
    // extra to pass, celo's full metadata is already on the registered Chain.
    switchChain({ chainId: target })
  }, [isConnected, connector, chainId, target, switchChain])
}
