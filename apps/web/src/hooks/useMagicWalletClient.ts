'use client'

import { useEffect, useState } from 'react'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { celo } from 'viem/chains'
import { getMagic } from '@/lib/magic'
import { useResolvedAuth } from './useResolvedAuth'

// A plain viem WalletClient backed directly by magic.rpcProvider — deliberately
// NOT a wagmi connector. Wagmi's connector abstraction (mirroring an SDK's
// connection state into wagmi's store) is what caused the Web3Auth bridge-race
// bug; this hook sidesteps that class of bug entirely by never touching wagmi's
// connector state. wagmi stays read-only (public RPC transport, no connector).
export function useMagicWalletClient(): WalletClient | undefined {
  const { status, address } = useResolvedAuth()
  const [walletClient, setWalletClient] = useState<WalletClient>()

  useEffect(() => {
    if (status !== 'ready' || !address) {
      setWalletClient(undefined)
      return
    }
    const magic = getMagic()
    if (!magic) return
    setWalletClient(
      createWalletClient({
        account: address,
        chain: celo,
        transport: custom(magic.rpcProvider),
      }),
    )
  }, [status, address])

  return walletClient
}
