import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useConfig } from 'wagmi'
import { readContract } from '@wagmi/core'
import { parseUnits, parseSignature } from 'viem'
import { useState } from 'react'
import type { Item, InventoryItem } from '@/types'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useAchievements } from '@/hooks/useAchievements'
import { useActiveWalletClient } from '@/hooks/useActiveWalletClient'
import { chainSpendConfig } from '@/editions/chain'
import { edition } from '@/editions'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
// Both the marketplace and the spend currency come from the ACTIVE EDITION
// rather than from a global. Valor deploys its own marketplace to every chain it
// runs on, at a different address each time, and the currency differs too (G$ on
// Celo, USDm in MiniPay).
//
// Resolved per call, not at module load: `edition()` reads the host at first use,
// and a module-level constant would freeze whatever the first import saw.


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
  const walletClient = useActiveWalletClient()

  const purchase = async (item: Item): Promise<string> => {
    if (!walletAddress) throw new Error('Not signed in')
    if (!walletClient?.account) throw new Error('Wallet not connected')

    // Everything below — token, marketplace, permit domain, price — has to come
    // from the same chain or the signature will not match the listing.
    const spendChainId = edition().chain.id
    const spend = chainSpendConfig(spendChainId)
    if (!spend) throw new Error('That currency is not available right now')

    const unitPrice = item.price_g

    const MARKETPLACE_CONTRACT = spend.marketplace
    const CURRENCY = spend.currency

    setPendingItemId(item.id)
    try {
      const amount   = parseUnits(unitPrice.toString(), spend.decimals)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30) // 30-min window

      // Check G$ balance before attempting — surface a clear error instead of contract revert
      const balance = await readContract(config, {
        address: CURRENCY,
        abi: BALANCE_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      })
      if (balance < amount) {
        throw new Error(`Insufficient ${spend.symbol} balance`)
      }

      // Read player's current permit nonce from the G$ token contract
      const nonce = await readContract(config, {
        address: CURRENCY,
        abi: NONCES_ABI,
        functionName: 'nonces',
        args: [walletAddress as `0x${string}`],
      })

      // Sign EIP-2612 permit — wallet shows "Sign message", zero gas for player
      const rawSig = await walletClient.signTypedData({
        account: walletClient.account,
        domain: spend.permit,
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
        // Relay-fuel failures are OURS, and the backend now says so explicitly.
        // Check this BEFORE the permit match: the node's out-of-gas error text
        // contains the word "permit", so the signature branch used to swallow it
        // and tell the player to re-sign — advice that could never work.
        if (body.code === 'RELAY_OUT_OF_GAS') throw new Error(msg)
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
