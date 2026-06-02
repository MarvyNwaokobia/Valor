import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWriteContract } from 'wagmi'
import { parseUnits } from 'viem'
import type { Item } from '@/types'
import { ITEM_RARITY_COLORS } from '@/lib/constants'
import { G_TOKEN_ADDRESS } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'

const G_TOKEN_ABI = [
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

interface Props {
  item: Item
  walletAddress: string | undefined
}

export default function MarketplaceItem({ item, walletAddress }: Props) {
  const [purchased, setPurchased] = useState(false)
  const rarityColor = ITEM_RARITY_COLORS[item.rarity]
  const isLimited = item.total_supply !== null
  const isSoldOut = isLimited && item.remaining_supply === 0

  const { writeContract, isPending } = useWriteContract()

  function handlePurchase() {
    if (!walletAddress || isSoldOut) return

    const marketplaceAddress = import.meta.env.VITE_MARKETPLACE_CONTRACT as `0x${string}`
    const itemIdBytes = `0x${item.id.replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`
    const amount = parseUnits(item.price_g.toString(), 18)

    writeContract(
      {
        address: G_TOKEN_ADDRESS,
        abi: G_TOKEN_ABI,
        functionName: 'transferAndCall',
        args: [marketplaceAddress, amount, itemIdBytes],
      },
      {
        onSuccess: () => setPurchased(true),
      },
    )
  }

  return (
    <motion.div
      className="flex flex-col gap-3 p-4 bg-valor-surface border rounded-xl transition-colors"
      style={{ borderColor: `${rarityColor}44` }}
      whileHover={{ scale: 1.02 }}
    >
      <div className="flex items-start justify-between">
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ color: rarityColor, background: `${rarityColor}22` }}
        >
          {item.rarity.toUpperCase()}
        </span>
        {isLimited && (
          <span className="text-xs text-orange-400 font-bold">
            {isSoldOut ? 'SOLD OUT' : `${item.remaining_supply} left`}
          </span>
        )}
      </div>

      <div className="w-full aspect-square bg-valor-surface-2 rounded-lg flex items-center justify-center text-4xl">
        {item.category === 'weapon' ? '⚔️' : item.category === 'shield' ? '🛡️' : '⚡'}
      </div>

      <div>
        <p className="font-bold text-white text-sm">{item.name}</p>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
      </div>

      <div className="flex items-center justify-between mt-auto">
        <span className="font-bold text-valor-gold text-sm">{formatGDollarNumber(item.price_g)}</span>
        <span className="text-xs text-slate-400">+{item.stat_boost} {item.category === 'weapon' ? 'ATK' : item.category === 'shield' ? 'DEF' : 'XP'}</span>
      </div>

      {purchased ? (
        <p className="text-center text-green-400 text-sm font-bold">Purchased ✓</p>
      ) : (
        <button
          onClick={handlePurchase}
          disabled={!walletAddress || isSoldOut || isPending}
          className="w-full py-2 text-sm font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: isSoldOut ? '#374151' : rarityColor,
            color: isSoldOut ? '#6b7280' : '#000',
          }}
        >
          {isPending ? 'Confirming...' : isSoldOut ? 'Sold Out' : 'Buy'}
        </button>
      )}
    </motion.div>
  )
}
