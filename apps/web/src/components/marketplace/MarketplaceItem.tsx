import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sword, Shield, Zap, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Item } from '@/types'
import { ITEM_RARITY_COLORS } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'
import { usePurchaseItem } from '@/hooks/useMarketplace'
import { usePlayerStore } from '@/stores/usePlayerStore'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  weapon:   Sword,
  shield:   Shield,
  booster:  Zap,
  cosmetic: Sparkles,
}

const STAT_LABELS: Record<string, string> = {
  weapon: 'ATK',
  shield: 'DEF',
  booster: 'XP×2',
}

interface Props {
  item: Item
  walletAddress: string | undefined
}

export default function MarketplaceItem({ item, walletAddress }: Props) {
  const { purchase, pendingItemId } = usePurchaseItem(walletAddress)
  const inventory = usePlayerStore((s) => s.inventory)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const rarityColor = ITEM_RARITY_COLORS[item.rarity]
  const isLimited   = item.total_supply !== null
  const isSoldOut   = isLimited && (item.remaining_supply ?? 0) <= 0
  const isPending   = pendingItemId === item.id
  const alreadyOwned = inventory.some((i) => i.item_id === item.id)

  async function handleBuy() {
    setError(null)
    setTxHash(null)
    try {
      const hash = await purchase(item)
      setTxHash(hash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed')
    }
  }

  return (
    <motion.div
      className="flex flex-col gap-3 p-4 bg-valor-surface rounded-xl border transition-all"
      style={{ borderColor: `${rarityColor}33` }}
      whileHover={!isSoldOut && !alreadyOwned ? { scale: 1.02, y: -2 } : {}}
      layout
    >
      {/* Rarity + supply */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ color: rarityColor, background: `${rarityColor}22` }}
        >
          {item.rarity.toUpperCase()}
        </span>
        {isLimited && (
          <span className={`text-xs font-bold ${isSoldOut ? 'text-red-400' : 'text-orange-400'}`}>
            {isSoldOut ? 'SOLD OUT' : `${item.remaining_supply} left`}
          </span>
        )}
      </div>

      {/* Icon */}
      <div
        className="w-full aspect-square rounded-xl flex items-center justify-center border"
        style={{ background: `${rarityColor}0d`, borderColor: `${rarityColor}22` }}
      >
        {(() => {
          const Icon = CATEGORY_ICONS[item.category] ?? Sword
          return <Icon size={40} strokeWidth={1.2} style={{ color: rarityColor }} />
        })()}
      </div>

      {/* Name + desc */}
      <div>
        <p className="font-bold text-white text-sm leading-tight">{item.name}</p>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
          {item.description}
        </p>
      </div>

      {/* Price + stat */}
      <div className="flex items-center justify-between mt-auto">
        <span className="font-bold text-valor-gold">{formatGDollarNumber(item.price_g)} G$</span>
        {item.stat_boost > 0 && (
          <span className="text-xs text-slate-400 font-bold">
            +{item.stat_boost} {STAT_LABELS[item.category]}
          </span>
        )}
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      {txHash && (
        <p className="text-green-400 text-xs truncate">
          ✓ Purchased
        </p>
      )}

      {/* Action button */}
      {alreadyOwned ? (
        <div className="w-full py-2 text-center text-xs font-bold text-green-400 bg-green-500/10 rounded-lg border border-green-500/20">
          ✓ Owned
        </div>
      ) : (
        <motion.button
          onClick={handleBuy}
          disabled={!walletAddress || isSoldOut || isPending}
          whileTap={!isSoldOut ? { scale: 0.97 } : {}}
          className="w-full py-2.5 text-sm font-bold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: isSoldOut ? '#374151' : rarityColor,
            color: isSoldOut ? '#6b7280' : '#000',
          }}
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-2">
              <motion.span
                className="w-3.5 h-3.5 rounded-full border-2 border-black border-t-transparent inline-block"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
              />
              Purchasing...
            </span>
          ) : isSoldOut ? (
            'Sold Out'
          ) : !walletAddress ? (
            'Sign in to buy'
          ) : (
            'Buy with G$'
          )}
        </motion.button>
      )}
    </motion.div>
  )
}
