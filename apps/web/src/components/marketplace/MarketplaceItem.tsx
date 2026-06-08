'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sword, Shield, Zap, Sparkles, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Item } from '@/types'
import { ITEM_RARITY_COLORS } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'
import { usePurchaseItem } from '@/hooks/useMarketplace'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useGBalance } from '@/hooks/useGBalance'

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

function isUserRejection(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return msg.includes('rejected') || msg.includes('denied') || msg.includes('user cancel') || msg.includes('user declin')
}

interface Props {
  item: Item
  walletAddress: string | undefined
}

export default function MarketplaceItem({ item, walletAddress }: Props) {
  const { purchase, pendingItemId } = usePurchaseItem(walletAddress)
  const inventory = usePlayerStore((s) => s.inventory)
  const { refetch: refetchBalance } = useGBalance(walletAddress as `0x${string}` | undefined)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [purchased, setPurchased]     = useState(false)

  const rarityColor  = ITEM_RARITY_COLORS[item.rarity]
  const isLimited    = item.total_supply !== null
  const isSoldOut    = isLimited && (item.remaining_supply ?? 0) <= 0
  const isPending    = pendingItemId === item.id
  const alreadyOwned = inventory.some((i) => i.item_id === item.id)

  async function handleConfirm() {
    setError(null)
    try {
      await purchase(item)
      setPurchased(true)
      setShowConfirm(false)
      refetchBalance()
    } catch (err) {
      if (isUserRejection(err)) {
        setShowConfirm(false)
      } else if (err instanceof Error && err.message === 'Insufficient G$ balance') {
        setError('You don\'t have enough G$ to buy this item.')
      } else {
        setError('Purchase could not be completed. Please try again.')
        console.error('[Purchase]', err)
      }
    }
  }

  return (
    <>
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
        {purchased && (
          <p className="text-green-400 text-xs">✓ Purchased</p>
        )}

        {/* Action button */}
        {alreadyOwned ? (
          <div className="w-full py-2 text-center text-xs font-bold text-green-400 bg-green-500/10 rounded-lg border border-green-500/20">
            ✓ Owned
          </div>
        ) : (
          <motion.button
            onClick={() => { setError(null); setShowConfirm(true) }}
            disabled={!walletAddress || isSoldOut}
            whileTap={!isSoldOut ? { scale: 0.97 } : {}}
            className="w-full py-2.5 text-sm font-bold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: isSoldOut ? '#374151' : rarityColor,
              color: isSoldOut ? '#6b7280' : '#000',
            }}
          >
            {isSoldOut ? 'Sold Out' : !walletAddress ? 'Sign in to buy' : 'Buy with G$'}
          </motion.button>
        )}
      </motion.div>

      {/* Confirmation modal */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget && !isPending) setShowConfirm(false) }}
          >
            <motion.div
              className="w-full max-w-xs rounded-2xl border flex flex-col gap-5 p-6"
              style={{ background: '#12121a', borderColor: '#2a2a3a' }}
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display font-black text-white text-xl leading-tight">
                    Confirm Purchase
                  </h2>
                  <p className="text-slate-500 text-xs mt-0.5">One-tap authorization · No gas fees</p>
                </div>
                {!isPending && (
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="text-slate-500 hover:text-white transition-colors shrink-0 mt-0.5"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* Item details */}
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: `${rarityColor}10`, border: `1px solid ${rarityColor}22` }}>
                {(() => {
                  const Icon = CATEGORY_ICONS[item.category] ?? Sword
                  return <Icon size={28} strokeWidth={1.2} style={{ color: rarityColor }} className="shrink-0" />
                })()}
                <div className="min-w-0">
                  <p className="font-bold text-white text-sm truncate">{item.name}</p>
                  {item.stat_boost > 0 && (
                    <p className="text-xs mt-0.5" style={{ color: rarityColor }}>
                      +{item.stat_boost} {STAT_LABELS[item.category]}
                    </p>
                  )}
                </div>
              </div>

              {/* Price row */}
              <div className="flex items-center justify-between py-2 border-t" style={{ borderColor: '#2a2a3a' }}>
                <span className="text-slate-400 text-sm">Total</span>
                <span className="font-black text-valor-gold text-lg">{formatGDollarNumber(item.price_g)} G$</span>
              </div>

              {error && <p className="text-red-400 text-xs -mt-2">{error}</p>}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={isPending}
                  className="flex-1 py-2.5 text-sm font-bold rounded-xl border text-slate-400 hover:text-white transition-colors disabled:opacity-40"
                  style={{ borderColor: '#2a2a3a' }}
                >
                  Cancel
                </button>
                <motion.button
                  onClick={handleConfirm}
                  disabled={isPending}
                  whileTap={{ scale: 0.97 }}
                  className="flex-1 py-2.5 text-sm font-black rounded-xl text-black transition-opacity disabled:opacity-60"
                  style={{ background: rarityColor }}
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <motion.span
                        className="w-3.5 h-3.5 rounded-full border-2 border-black border-t-transparent inline-block"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                      />
                      Processing...
                    </span>
                  ) : (
                    'Sign & Buy'
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
