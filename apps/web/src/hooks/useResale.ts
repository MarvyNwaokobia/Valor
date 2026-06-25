import { useCallback, useState } from 'react'
import { writeContract, readContract, waitForTransactionReceipt } from '@wagmi/core'
import { useSignTypedData } from 'wagmi'
import { parseUnits, parseSignature } from 'viem'
import { wagmiConfig } from '@/lib/wagmi'
import { G_TOKEN_ADDRESS } from '@/lib/constants'
import type { Item } from '@/types'

/**
 * Player-to-player resale against the upgraded ValorMarketplace (approval-based).
 *
 * Listing/cancelling are direct wallet txs (the seller approves the marketplace as
 * an ERC-1155 operator once, then lists). Buying signs an EIP-2612 G$ permit so the
 * buyer needs no separate approve tx. Resale guns must be registered on-chain
 * (item.on_chain_id != null) to be listable.
 */

const MARKETPLACE = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT as `0x${string}`
const G_DECIMALS = 18

const MARKETPLACE_ABI = [
  { name: 'items', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'listForResale', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'itemId', type: 'uint256' }, { name: 'price', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'cancelResale', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'resaleId', type: 'uint256' }], outputs: [] },
  { name: 'buyResaleWithPermit', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'resaleId', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
    ], outputs: [] },
  { name: 'getActiveResales', type: 'function', stateMutability: 'view', inputs: [], outputs: [
      { name: 'ids', type: 'uint256[]' },
      { name: 'entries', type: 'tuple[]', components: [
        { name: 'seller', type: 'address' }, { name: 'itemId', type: 'uint256' },
        { name: 'price', type: 'uint256' }, { name: 'active', type: 'bool' },
      ] },
  ] },
] as const

const ITEMS_ABI = [
  { name: 'isApprovedForAll', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }, { name: 'operator', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'setApprovalForAll', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }], outputs: [] },
] as const

const NONCES_ABI = [
  { name: 'nonces', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export interface ResaleListing {
  resaleId: bigint
  seller: string
  itemId: bigint   // on-chain item id
  price: bigint    // G$ wei
}

export function useResale(walletAddress?: string) {
  const { signTypedDataAsync } = useSignTypedData()
  const [pending, setPending] = useState(false)

  const itemsAddress = useCallback(
    () => readContract(wagmiConfig, { address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'items' }) as Promise<`0x${string}`>,
    [],
  )

  /** List an owned item for resale at `priceG` G$ (approves the marketplace first if needed). */
  const listForResale = useCallback(async (item: Item, priceG: number): Promise<`0x${string}`> => {
    if (!walletAddress) throw new Error('Not signed in')
    if (!MARKETPLACE) throw new Error('Marketplace not configured')
    if (item.on_chain_id == null) throw new Error('This item is not registered on-chain yet — can’t list it')
    if (!(priceG > 0)) throw new Error('Enter a price greater than 0')

    setPending(true)
    try {
      const items = await itemsAddress()
      const approved = await readContract(wagmiConfig, {
        address: items, abi: ITEMS_ABI, functionName: 'isApprovedForAll',
        args: [walletAddress as `0x${string}`, MARKETPLACE],
      })
      if (!approved) {
        const ah = await writeContract(wagmiConfig, {
          address: items, abi: ITEMS_ABI, functionName: 'setApprovalForAll', args: [MARKETPLACE, true],
        })
        await waitForTransactionReceipt(wagmiConfig, { hash: ah })
      }
      const price = parseUnits(priceG.toString(), G_DECIMALS)
      const hash = await writeContract(wagmiConfig, {
        address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'listForResale',
        args: [BigInt(item.on_chain_id), price],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash })
      return hash
    } finally {
      setPending(false)
    }
  }, [walletAddress, itemsAddress])

  const cancelResale = useCallback(async (resaleId: bigint): Promise<`0x${string}`> => {
    setPending(true)
    try {
      const hash = await writeContract(wagmiConfig, {
        address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'cancelResale', args: [resaleId],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash })
      return hash
    } finally {
      setPending(false)
    }
  }, [])

  /** Buy a resale listing — signs a G$ permit (no separate approve), then settles. */
  const buyResale = useCallback(async (resaleId: bigint, price: bigint): Promise<`0x${string}`> => {
    if (!walletAddress) throw new Error('Not signed in')
    setPending(true)
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30)
      const nonce = await readContract(wagmiConfig, {
        address: G_TOKEN_ADDRESS, abi: NONCES_ABI, functionName: 'nonces', args: [walletAddress as `0x${string}`],
      })
      const rawSig = await signTypedDataAsync({
        domain: { name: 'GoodDollar', version: '1', chainId: 42220, verifyingContract: G_TOKEN_ADDRESS },
        types: { Permit: [
          { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
        ] },
        primaryType: 'Permit',
        message: { owner: walletAddress as `0x${string}`, spender: MARKETPLACE, value: price, nonce, deadline },
      })
      const { v, r, s } = parseSignature(rawSig)
      const hash = await writeContract(wagmiConfig, {
        address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'buyResaleWithPermit',
        args: [resaleId, deadline, Number(v), r, s],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash })
      return hash
    } finally {
      setPending(false)
    }
  }, [walletAddress, signTypedDataAsync])

  /** All active resale listings on-chain (the marketplace reads this to show what's for sale). */
  const fetchListings = useCallback(async (): Promise<ResaleListing[]> => {
    const [ids, entries] = await readContract(wagmiConfig, {
      address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'getActiveResales',
    }) as [readonly bigint[], readonly { seller: string; itemId: bigint; price: bigint; active: boolean }[]]
    return ids.map((id, i) => ({ resaleId: id, seller: entries[i].seller, itemId: entries[i].itemId, price: entries[i].price }))
  }, [])

  return { listForResale, cancelResale, buyResale, fetchListings, pending }
}
