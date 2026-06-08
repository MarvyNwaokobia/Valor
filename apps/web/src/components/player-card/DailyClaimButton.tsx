'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useGoodDollarClaim } from '@/hooks/useGoodDollarClaim'
import { useGBalance } from '@/hooks/useGBalance'

interface Props {
  walletAddress: `0x${string}`
}

export default function DailyClaimButton({ walletAddress }: Props) {
  const [showModal, setShowModal] = useState(false)

  const { refetch: refetchBalance } = useGBalance(walletAddress)

  const { status, entitlement, nextClaimTime, claiming, claimStep, txHash, error, claim } =
    useGoodDollarClaim(walletAddress, () => {
      refetchBalance()
    })

  async function handleClaim() {
    await claim()
    // Keep modal open on error so user can see it; close on success (txHash set)
  }

  // Close modal when success is confirmed (txHash available)
  const isSuccess = !!txHash

  const nextClaimLabel = nextClaimTime
    ? (() => {
        const ms = nextClaimTime.getTime() - Date.now()
        if (ms <= 0) return 'now'
        const h = Math.floor(ms / 3_600_000)
        const m = Math.floor((ms % 3_600_000) / 60_000)
        return h > 0 ? `${h}h ${m}m` : `${m}m`
      })()
    : null

  return (
    <>
      {/* ── Card ── */}
      <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-white text-sm">Daily G$</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">GoodDollar UBI</p>
          </div>
          {/* GoodDollar logo pill */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded"
            style={{ background: 'rgba(0,191,114,0.08)', border: '1px solid rgba(0,191,114,0.2)' }}>
            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#00bf72' }}>GoodDollar</span>
          </div>
        </div>

        {status === 'loading' && (
          <div className="h-9 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
        )}

        {status === 'can_claim' && (
          <motion.button
            onClick={() => setShowModal(true)}
            whileTap={{ scale: 0.97 }}
            className="w-full py-2.5 font-black text-sm rounded-lg transition-colors"
            style={{ background: '#00bf72', color: '#04030c' }}
          >
            Claim ~{entitlement} G$
          </motion.button>
        )}

        {status === 'already_claimed' && (
          <div className="text-center py-1">
            {isSuccess ? (
              <motion.p
                className="text-sm font-bold"
                style={{ color: '#00bf72' }}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
              >
                G$ claimed!
              </motion.p>
            ) : (
              <p className="text-xs text-slate-500">
                {nextClaimLabel ? `Next claim in ${nextClaimLabel}` : 'Claimed today'}
              </p>
            )}
          </div>
        )}

        {status === 'not_whitelisted' && (
          <p className="text-xs text-slate-500 text-center">
            Complete identity verification to claim daily G$
          </p>
        )}

        {status === 'error' && (
          <p className="text-xs text-red-400 text-center">
            Could not load claim status
          </p>
        )}
      </div>

      {/* ── Confirmation modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
              if (e.target === e.currentTarget && !claiming) setShowModal(false)
            }}
          >
            <motion.div
              className="w-full max-w-xs rounded-2xl border flex flex-col gap-5 p-6"
              style={{ background: '#12121a', borderColor: '#2a2a3a' }}
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 22, stiffness: 300 }}
            >
              {/* ── Header ── */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display font-black text-white text-xl leading-tight">
                    {isSuccess ? 'G$ Claimed!' : 'Claim Daily G$'}
                  </h2>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {isSuccess
                      ? 'Your wallet balance has been updated'
                      : claiming
                        ? claimStep
                        : 'Sign once · Direct to your wallet'}
                  </p>
                </div>
                {!claiming && (
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-slate-500 hover:text-white transition-colors shrink-0 mt-0.5"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* ── Amount display ── */}
              {!isSuccess && (
                <div
                  className="flex items-center justify-between p-4 rounded-xl"
                  style={{ background: 'rgba(0,191,114,0.06)', border: '1px solid rgba(0,191,114,0.18)' }}
                >
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-bold mb-0.5"
                      style={{ color: 'rgba(0,191,114,0.6)' }}>
                      Your entitlement
                    </p>
                    <p className="font-display font-black text-white text-2xl leading-none">
                      ~{entitlement}
                      <span className="text-sm font-bold ml-1.5" style={{ color: '#00bf72' }}>G$</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-slate-600 uppercase tracking-wider">Source</p>
                    <p className="text-xs font-bold" style={{ color: '#00bf72' }}>GoodDollar</p>
                  </div>
                </div>
              )}

              {/* ── Success amount ── */}
              {isSuccess && (
                <motion.div
                  className="flex flex-col items-center gap-2 py-2"
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 18, stiffness: 280 }}
                >
                  <div className="w-14 h-14 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,191,114,0.12)', border: '1px solid rgba(0,191,114,0.3)' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                      <path d="M5 13l4 4L19 7" stroke="#00bf72" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="font-display font-black text-white text-lg">
                    +{entitlement === '0' ? '~' : entitlement} G$ received
                  </p>
                </motion.div>
              )}

              {/* ── Gas note (shown when claiming) ── */}
              {claiming && claimStep.includes('Gas') && (
                <div className="px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.18)' }}>
                  <p className="text-[10px] text-amber-400/80 leading-relaxed">
                    Your wallet needs a small CELO top-up for gas. A second signing prompt will appear — this is automatic and free.
                  </p>
                </div>
              )}

              {error && (
                <p className="text-red-400 text-xs -mt-2 text-center">{error}</p>
              )}

              {/* ── Actions ── */}
              {!isSuccess && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowModal(false)}
                    disabled={claiming}
                    className="flex-1 py-2.5 text-sm font-bold rounded-xl border text-slate-400 hover:text-white transition-colors disabled:opacity-40"
                    style={{ borderColor: '#2a2a3a' }}
                  >
                    Cancel
                  </button>
                  <motion.button
                    onClick={handleClaim}
                    disabled={claiming}
                    whileTap={{ scale: 0.97 }}
                    className="flex-1 py-2.5 text-sm font-black rounded-xl text-black transition-opacity disabled:opacity-60"
                    style={{ background: '#00bf72' }}
                  >
                    {claiming ? (
                      <span className="flex items-center justify-center gap-2">
                        <motion.span
                          className="w-3.5 h-3.5 rounded-full border-2 border-black border-t-transparent inline-block"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
                        />
                        Claiming...
                      </span>
                    ) : (
                      'Claim G$'
                    )}
                  </motion.button>
                </div>
              )}

              {isSuccess && (
                <motion.button
                  onClick={() => setShowModal(false)}
                  whileTap={{ scale: 0.97 }}
                  className="w-full py-2.5 text-sm font-black rounded-xl text-black"
                  style={{ background: '#00bf72' }}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  Done
                </motion.button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
