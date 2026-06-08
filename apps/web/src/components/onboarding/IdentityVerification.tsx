'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGoodDollarIdentity } from '@/hooks/useGoodDollarIdentity'
import { usePlayerStore } from '@/stores/usePlayerStore'

interface Props {
  walletAddress: `0x${string}`
  onVerified: () => void
}

export default function IdentityVerification({ walletAddress, onVerified }: Props) {
  const setVerified = usePlayerStore((s) => s.setVerified)
  const { status, faceVerifyUrl, error, check, getFaceVerifyUrl, reset } = useGoodDollarIdentity()

  // Auto-trigger on mount — no button click needed
  useEffect(() => {
    check(walletAddress).then(verified => {
      if (verified) {
        setVerified(true)
        setTimeout(onVerified, 900)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleRecheckAfterFV() {
    const verified = await check(walletAddress)
    if (verified) {
      setVerified(true)
      setTimeout(onVerified, 900)
    }
  }

  const isChecking = status === 'idle' || status === 'checking' || status === 'switching_chain'

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6" style={{ background: '#04030c' }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 50% 55%, rgba(0,191,114,0.06), transparent)',
      }} />

      <AnimatePresence mode="wait">

        {/* ── CHECKING ─────────────────────────────────────────────── */}
        {isChecking && (
          <motion.div
            key="checking"
            className="relative z-10 flex flex-col items-center gap-5 text-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="w-14 h-14 rounded-full border-2"
              style={{ borderColor: '#00bf72', borderTopColor: 'transparent' }}
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
            />
            <div>
              <p className="font-display font-black text-white text-xl">
                {status === 'switching_chain' ? 'Switching to Celo...' : 'Checking your identity...'}
              </p>
              <p className="text-slate-500 text-sm mt-1">Check your wallet if prompted — this is free.</p>
            </div>
          </motion.div>
        )}

        {/* ── VERIFICATION REQUIRED ────────────────────────────────── */}
        {status === 'not_whitelisted' && (
          <motion.div
            key="fv"
            className="relative z-10 flex flex-col items-center gap-6 max-w-sm w-full text-center"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,191,114,0.08)', border: '2px solid rgba(0,191,114,0.25)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 2a5 5 0 1 1 0 10A5 5 0 0 1 12 2zm0 12c-5.33 0-8 2.67-8 4v2h16v-2c0-1.33-2.67-4-8-4z"
                  fill="#00bf72" fillOpacity="0.8" />
              </svg>
            </div>

            <div>
              <p className="font-display font-black text-white text-2xl">Verification Required</p>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                Complete a quick GoodDollar identity check to enter Valor. Takes under 60 seconds — your data stays private.
              </p>
            </div>

            {faceVerifyUrl ? (
              <a
                href={faceVerifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-4 font-display font-black uppercase tracking-widest text-sm rounded-xl flex items-center justify-center gap-2"
                style={{ background: '#00bf72', color: '#04030c' }}
              >
                Verify Identity <span className="opacity-60 text-base">↗</span>
              </a>
            ) : (
              <motion.button
                onClick={getFaceVerifyUrl}
                whileTap={{ scale: 0.97 }}
                className="w-full py-4 font-display font-black uppercase tracking-widest text-sm rounded-xl"
                style={{ background: '#00bf72', color: '#04030c' }}
              >
                Get Verification Link
              </motion.button>
            )}

            <button
              onClick={handleRecheckAfterFV}
              className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              Already verified — continue
            </button>
          </motion.div>
        )}

        {/* ── SUCCESS ──────────────────────────────────────────────── */}
        {status === 'whitelisted' && (
          <motion.div
            key="done"
            className="relative z-10 flex flex-col items-center gap-4"
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 16 }}
          >
            <div className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,191,114,0.12)', border: '2px solid rgba(0,191,114,0.4)' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="#00bf72" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="font-display font-black text-white text-2xl">Verified!</p>
            <p className="text-slate-400 text-sm">Entering Valor...</p>
          </motion.div>
        )}

        {/* ── ERROR ────────────────────────────────────────────────── */}
        {status === 'error' && (
          <motion.div
            key="error"
            className="relative z-10 flex flex-col items-center gap-5 max-w-sm w-full text-center"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          >
            <div className="px-4 py-3 rounded-xl w-full"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <p className="text-red-400 text-sm">{error}</p>
            </div>
            <button
              onClick={reset}
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Try again
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
