import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWriteContract } from 'wagmi'
import { parseUnits, encodeAbiParameters, parseAbiParameters } from 'viem'
import { useState } from 'react'
import { G_TOKEN_ADDRESS } from '@/lib/constants'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
import type { Item, InventoryItem } from '@/types'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useAchievements } from '@/hooks/useAchievements'

const TRANSFER_AND_CALL_ABI = [
  {
    name: 'transferAndCall',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
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

  const { writeContractAsync } = useWriteContract()

  const purchase = async (item: Item) => {
    if (!walletAddress) throw new Error('Wallet not connected')

    const marketplaceAddress = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT as `0x${string}`
    if (!marketplaceAddress) throw new Error('Marketplace contract not configured')

    if (item.on_chain_id === null) throw new Error('Item not yet registered on-chain')

    setPendingItemId(item.id)

    // Encode on_chain_id as uint256 — matches the contract's abi.decode(data, (uint256))
    const itemIdBytes = encodeAbiParameters(
      parseAbiParameters('uint256'),
      [BigInt(item.on_chain_id)],
    )
    const amount = parseUnits(item.price_g.toString(), 18)

    try {
      const txHash = await writeContractAsync({
        address: G_TOKEN_ADDRESS,
        abi: TRANSFER_AND_CALL_ABI,
        functionName: 'transferAndCall',
        args: [marketplaceAddress, amount, itemIdBytes],
      })

      // Optimistically add to inventory while tx confirms
      const newInventoryItem: InventoryItem = {
        wallet_address: walletAddress,
        item_id: item.id,
        equipped: false,
        acquired_at: new Date().toISOString(),
      }
      addInventoryItem(newInventoryItem)

      // Persist to Railway API
      await fetch(`${API}/players/${walletAddress}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      })

      queryClient.invalidateQueries({ queryKey: ['marketplace-items'] })

      // Check inventory >= 5 achievement after purchase
      checkAchievements(walletAddress).catch(console.error)

      return txHash
    } finally {
      setPendingItemId(null)
    }
  }

  return { purchase, pendingItemId }
}
