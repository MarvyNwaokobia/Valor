import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useConfig, useSignTypedData } from 'wagmi'
import { readContract } from '@wagmi/core'
import { parseUnits, parseSignature } from 'viem'
import { useState } from 'react'
import { G_TOKEN_ADDRESS } from '@/lib/constants'
import type { Item, InventoryItem } from '@/types'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useAchievements } from '@/hooks/useAchievements'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
const MARKETPLACE_CONTRACT = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT as `0x${string}`

// G$ is 18 decimals on Celo mainnet (SuperToken)
const G_DECIMALS = 18

const NONCES_ABI = [
  {
    name: 'nonces',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export function useMarketplaceItems() {
  return useQuery({
    queryKey: ['marketplace-items'],
    queryFn: async () => {
      const res = await fetch(`${API}/items`)
      if (!res.ok) throw new Error('Failed to fetch items')
      return res.json() as Promise<Item[]>
    },
    staleTime: 30_000,
  })
}

export function usePurchaseItem(walletAddress: string | undefined) {
  const queryClient = useQueryClient()
  const addInventoryItem = usePlayerStore((s) => s.addInventoryItem)
  const { checkAchievements } = useAchievements()
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)

  const config = useConfig()
  const { signTypedDataAsync } = useSignTypedData()

  const purchase = async (item: Item): Promise<string> => {
    if (!walletAddress) throw new Error('Not signed in')
    if (!MARKETPLACE_CONTRACT) throw new Error('Marketplace not configured')

    setPendingItemId(item.id)
    try {
      const amount   = parseUnits(item.price_g.toString(), G_DECIMALS)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30) // 30-min window

      // Check G$ balance before attempting — surface a clear error instead of contract revert
      const balance = await readContract(config, {
        address: G_TOKEN_ADDRESS,
        abi: BALANCE_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      })
      if (balance < amount) {
        throw new Error('Insufficient G$ balance')
      }

      // Read player's current permit nonce from the G$ token contract
      const nonce = await readContract(config, {
        address: G_TOKEN_ADDRESS,
        abi: NONCES_ABI,
        functionName: 'nonces',
        args: [walletAddress as `0x${string}`],
      })

      // Sign EIP-2612 permit — wallet shows "Sign message", zero gas for player
      const rawSig = await signTypedDataAsync({
        domain: {
          name: 'GoodDollar',
          version: '1',
          chainId: 42220,
          verifyingContract: G_TOKEN_ADDRESS,
        },
        types: {
          Permit: [
            { name: 'owner',    type: 'address' },
            { name: 'spender',  type: 'address' },
            { name: 'value',    type: 'uint256' },
            { name: 'nonce',    type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner:    walletAddress as `0x${string}`,
          spender:  MARKETPLACE_CONTRACT,
          value:    amount,
          nonce,
          deadline,
        },
      })

      // Split the 65-byte signature into v, r, s
      const { v, r, s } = parseSignature(rawSig)

      // Send to backend relay — backend submits purchaseWithPermit, pays CELO gas
      const res = await fetch(`${API}/items/${item.id}/purchase-relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: walletAddress,
          deadline: Number(deadline),
          v: Number(v),
          r,
          s,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Purchase failed' }))
        const msg = (body.error as string) ?? 'Purchase failed'
        if (msg === 'Already owned') throw new Error('You already own this item')
        if (msg.includes('permit')) throw new Error('Signature expired or invalid — please try again')
        throw new Error(msg)
      }

      const { tx_hash } = (await res.json()) as { tx_hash: string }

      // Optimistically update local inventory
      const newItem: InventoryItem = {
        wallet_address: walletAddress,
        item_id: item.id,
        equipped: false,
        acquired_at: new Date().toISOString(),
      }
      addInventoryItem(newItem)
      queryClient.invalidateQueries({ queryKey: ['marketplace-items'] })
      checkAchievements(walletAddress).catch(console.error)

      return tx_hash
    } finally {
      setPendingItemId(null)
    }
  }

  return { purchase, pendingItemId }
}
