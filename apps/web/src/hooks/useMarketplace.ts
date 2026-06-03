import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, encodeAbiParameters, parseAbiParameters } from 'viem'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { G_TOKEN_ADDRESS } from '@/lib/constants'
import type { Item, InventoryItem } from '@/types'
import { usePlayerStore } from '@/stores/usePlayerStore'

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
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .order('price_g', { ascending: true })
      if (error) throw error
      return (data ?? []) as Item[]
    },
    staleTime: 30_000,
  })
}

export function usePurchaseItem(walletAddress: string | undefined) {
  const queryClient = useQueryClient()
  const addInventoryItem = usePlayerStore((s) => s.addInventoryItem)
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()

  const purchase = async (item: Item) => {
    if (!walletAddress) throw new Error('Wallet not connected')

    const marketplaceAddress = import.meta.env.VITE_MARKETPLACE_CONTRACT as `0x${string}`
    if (!marketplaceAddress) throw new Error('Marketplace contract not configured')

    setPendingItemId(item.id)

    // Encode the item UUID as bytes32 for the contract
    const itemIdBytes = encodeAbiParameters(
      parseAbiParameters('bytes32'),
      [`0x${item.id.replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`],
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

      // Also persist to Supabase (the contract webhook will do this in production;
      // this is an optimistic insert for immediate UI feedback)
      await supabase.from('inventory').upsert(newInventoryItem, { onConflict: 'wallet_address,item_id' })

      // Update remaining_supply optimistically
      if (item.remaining_supply !== null) {
        await supabase
          .from('items')
          .update({ remaining_supply: item.remaining_supply - 1 })
          .eq('id', item.id)
      }

      queryClient.invalidateQueries({ queryKey: ['marketplace-items'] })
      return txHash
    } finally {
      setPendingItemId(null)
    }
  }

  return { purchase, pendingItemId }
}
