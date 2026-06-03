import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import type { Item } from '@/types'
import { formatCountdown, formatGDollarNumber } from '@/utils/format'
import { usePurchaseItem } from '@/hooks/useMarketplace'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { ITEM_RARITY_COLORS } from '@/lib/constants'

// The limited item ends at a fixed timestamp. This is set to 7 days from first deploy.
// In production this would come from a config or DB field.
const SALE_END_TIMESTAMP =
  typeof window !== 'undefined'
    ? (() => {
        const stored = localStorage.getItem('valor:limited-sale-end')
        if (stored) return parseInt(stored)
        const end = Date.now() + 7 * 24 * 60 * 60 * 1000
        localStorage.setItem('valor:limited-sale-end', String(end))
        return end
      })()
    : Date.now() + 7 * 24 * 60 * 60 * 1000

interface Props {
  item: Item
  walletAddress: string | undefined
}

export default function LimitedItemBanner({ item, walletAddress }: Props) {
  const { purchase, pendingItemId } = usePurchaseItem(walletAddress)
  const inventory = usePlayerStore((s) => s.inventory)
  const [timeLeft, setTimeLeft] = useState(Math.max(0, SALE_END_TIMESTAMP - Date.now()))
  const [error, setError] = useState<string | null>(null)

  const alreadyOwned = inventory.some((i) => i.item_id === item.id)
  const isSoldOut = (item.remaining_supply ?? 0) <= 0
  const isPending = pendingItemId === item.id
  const isExpired = timeLeft <= 0 && isSoldOut

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(Math.max(0, SALE_END_TIMESTAMP - Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  async function handleBuy() {
    setError(null)
    try {
      await purchase(item)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed')
    }
  }

  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl border-2 border-valor-gold/60 bg-valor-surface"
      style={{ boxShadow: '0 0 32px rgba(234,179,8,0.12)' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Gold shimmer header */}
      <div className="h-1 w-full bg-gradient-to-r from-valor-gold/40 via-valor-gold to-valor-gold/40" />

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-valor-gold/5 to-transparent" />

      <div className="relative z-10 p-6 flex flex-col sm:flex-row gap-6 items-center">
        {/* Icon */}
        <div className="w-24 h-24 rounded-2xl border-2 border-valor-gold/40 bg-valor-gold/10 flex items-center justify-center text-5xl shrink-0">
          ⚔️
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-valor-gold/20 text-valor-gold border border-valor-gold/40">
              LEGENDARY
            </span>
            <span className="text-xs font-bold text-orange-400">
              {isSoldOut
                ? 'SOLD OUT — GONE FOREVER'
                : `${item.remaining_supply} / ${item.total_supply} remaining`}
            </span>
          </div>

          <div>
            <p className="font-display font-bold text-white text-xl">{item.name}</p>
            <p className="text-slate-400 text-sm mt-1">{item.description}</p>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-bold text-valor-gold text-lg">
              {formatGDollarNumber(item.price_g)}
            </span>
            <span className="text-sm text-slate-400 font-bold">+{item.stat_boost} ATK</span>
          </div>
        </div>

        {/* CTA + countdown */}
        <div className="flex flex-col gap-3 items-center shrink-0">
          {!isSoldOut && timeLeft > 0 && (
            <div className="text-center">
              <p className="text-xs text-slate-500 mb-1">Ends in</p>
              <p className="font-mono font-bold text-valor-gold text-lg">
                {formatCountdown(timeLeft)}
              </p>
            </div>
          )}

          {alreadyOwned ? (
            <div className="px-6 py-2.5 text-sm font-bold text-green-400 bg-green-500/10 rounded-xl border border-green-500/20">
              ✓ You own this
            </div>
          ) : isSoldOut ? (
            <div className="px-6 py-2.5 text-sm font-bold text-slate-500 bg-valor-surface-2 rounded-xl border border-valor-border">
              Gone Forever
            </div>
          ) : (
            <motion.button
              onClick={handleBuy}
              disabled={!walletAddress || isPending}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="px-8 py-2.5 bg-valor-gold text-black font-bold rounded-xl hover:bg-valor-gold-light disabled:opacity-50 transition-colors text-sm"
            >
              {isPending ? 'Confirming...' : 'Buy Now'}
            </motion.button>
          )}

          {error && <p className="text-red-400 text-xs text-center max-w-32">{error}</p>}
        </div>
      </div>
    </motion.div>
  )
}
