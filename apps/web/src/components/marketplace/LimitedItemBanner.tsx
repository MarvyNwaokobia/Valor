'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sword, X } from 'lucide-react'
import type { Item } from '@/types'
import { formatCountdown, formatGDollarNumber } from '@/utils/format'
import { usePurchaseItem } from '@/hooks/useMarketplace'
import { usePlayerStore } from '@/stores/usePlayerStore'

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

function isUserRejection(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return msg.includes('rejected') || msg.includes('denied') || msg.includes('user cancel') || msg.includes('user declin')
}

interface Props {
  item: Item
  walletAddress: string | undefined
}

export default function LimitedItemBanner({ item, walletAddress }: Props) {
  const { purchase, pendingItemId } = usePurchaseItem(walletAddress)
  const inventory   = usePlayerStore((s) => s.inventory)
  const [timeLeft,     setTimeLeft]     = useState(Math.max(0, SALE_END_TIMESTAMP - Date.now()))
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const alreadyOwned = inventory.some((i) => i.item_id === item.id)
  const isSoldOut    = (item.remaining_supply ?? 0) <= 0
  const isPending    = pendingItemId === item.id
  const isExpired    = timeLeft <= 0 && isSoldOut

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(Math.max(0, SALE_END_TIMESTAMP - Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  async function handleConfirm() {
    setError(null)
    try {
      await purchase(item)
      setShowConfirm(false)
    } catch (err) {
      if (isUserRejection(err)) {
        setShowConfirm(false)
      } else {
        setError('Purchase could not be completed. Please try again.')
        console.error('[Purchase]', err)
      }
    }
  }

  return (
    <>
      <motion.div
        className="relative overflow-hidden rounded-2xl border-2 border-valor-gold/60 bg-valor-surface"
        style={{ boxShadow: '0 0 32px rgba(234,179,8,0.12)' }}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="h-1 w-full bg-linear-to-r from-valor-gold/40 via-valor-gold to-valor-gold/40" />
        <div className="absolute inset-0 pointer-events-none bg-linear-to-br from-valor-gold/5 to-transparent" />

        <div className="relative z-10 p-6 flex flex-col sm:flex-row gap-6 items-center">
          {/* Icon */}
          <div className="w-24 h-24 rounded-2xl border-2 border-valor-gold/40 bg-valor-gold/10 flex items-center justify-center shrink-0">
            <Sword size={48} className="text-valor-gold" strokeWidth={1.2} />
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
                {formatGDollarNumber(item.price_g)} G$
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
            ) : isExpired || isSoldOut ? (
              <div className="px-6 py-2.5 text-sm font-bold text-slate-500 bg-valor-surface-2 rounded-xl border border-valor-border">
                {isExpired ? 'Sale Ended' : 'Gone Forever'}
              </div>
            ) : (
              <motion.button
                onClick={() => { setError(null); setShowConfirm(true) }}
                disabled={!walletAddress}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="px-8 py-2.5 bg-valor-gold text-black font-bold rounded-xl hover:bg-valor-gold-light disabled:opacity-50 transition-colors text-sm"
              >
                Buy Now
              </motion.button>
            )}
          </div>
        </div>
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
                <h2 className="font-display font-black text-white text-xl leading-tight">
                  Confirm Purchase
                </h2>
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
              <div className="flex items-center gap-3 p-3 rounded-xl bg-valor-gold/10 border border-valor-gold/20">
                <Sword size={28} strokeWidth={1.2} className="text-valor-gold shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-white text-sm truncate">{item.name}</p>
                  <p className="text-xs text-valor-gold mt-0.5">+{item.stat_boost} ATK · LEGENDARY</p>
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
                  className="flex-1 py-2.5 text-sm font-black rounded-xl text-black bg-valor-gold hover:bg-valor-gold-light transition-colors disabled:opacity-60"
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
                    'Confirm Purchase'
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
