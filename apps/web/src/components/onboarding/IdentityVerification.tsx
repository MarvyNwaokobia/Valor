'use client'

import { useState } from 'react'
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
  const [signing, setSigning] = useState(false)

  async function handleVerify() {
    setSigning(true)
    const verified = await check(walletAddress)
    setSigning(false)
    if (verified) {
      setVerified(true)
      setTimeout(onVerified, 900)
    } else {
      await getFaceVerifyUrl()
    }
  }

  async function handleRecheckAfterFV() {
    const verified = await check(walletAddress)
    if (verified) {
      setVerified(true)
      setTimeout(onVerified, 900)
    }
  }

  const showIdle     = status === 'idle' && !signing
  const showChecking = signing || status === 'checking' || status === 'switching_chain'

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6" style={{ background: '#04030c' }}>

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 65% 45% at 50% 58%, rgba(0,191,114,0.07), transparent)',
      }} />

      <AnimatePresence mode="wait">

        {/* ── IDLE: intro ─────────────────────────────────────────── */}
        {showIdle && (
          <motion.div
            key="idle"
            className="relative z-10 flex flex-col items-center gap-7 max-w-sm w-full text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* GoodDollar badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(0,191,114,0.1)', border: '1px solid rgba(0,191,114,0.22)' }}>
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#00bf72' }}>
                Powered by GoodDollar
              </span>
            </div>

            <div>
              <h1 className="font-display font-black text-white leading-tight"
                style={{ fontSize: 'clamp(1.9rem, 6vw, 2.6rem)' }}>
                One Real Person
              </h1>
              <p className="text-slate-400 text-sm mt-3 leading-relaxed">
                Valor runs on GoodDollar — a real-people-only network. A quick check keeps every warrior genuine and the game fair.
              </p>
            </div>

            {/* Trust points */}
            <div className="flex flex-col gap-2 w-full">
              {[
                'Free — no cost, ever',
                'Private — your data never leaves GoodDollar',
                'Once — verify once, play forever',
              ].map(text => (
                <div key={text} className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-left"
                  style={{ background: 'rgba(0,191,114,0.06)', border: '1px solid rgba(0,191,114,0.12)' }}>
                  <span className="font-black text-sm shrink-0" style={{ color: '#00bf72' }}>✓</span>
                  <span className="text-sm text-slate-300">{text}</span>
                </div>
              ))}
            </div>

            <motion.button
              onClick={handleVerify}
              whileHover={{ scale: 1.02, filter: 'brightness(1.1)' }}
              whileTap={{ scale: 0.97 }}
              className="w-full py-4 font-display font-black uppercase tracking-widest text-sm rounded-xl"
              style={{ background: '#00bf72', color: '#04030c' }}
            >
              Continue with Verification
            </motion.button>
          </motion.div>
        )}

        {/* ── CHECKING: "check your wallet" ───────────────────────── */}
        {showChecking && (
          <motion.div
            key="checking"
            className="relative z-10 flex flex-col items-center gap-6 max-w-sm w-full text-center"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="w-16 h-16 rounded-full border-2"
              style={{ borderColor: '#00bf72', borderTopColor: 'transparent' }}
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
            />
            <div>
              <p className="font-display font-black text-white text-xl">Check your wallet</p>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                {status === 'switching_chain'
                  ? 'Switching to the Celo network...'
                  : 'Sign the request to confirm your identity. This is free and takes seconds.'}
              </p>
            </div>
          </motion.div>
        )}

        {/* ── NOT WHITELISTED: face scan required ─────────────────── */}
        {status === 'not_whitelisted' && !signing && (
          <motion.div
            key="fv"
            className="relative z-10 flex flex-col items-center gap-6 max-w-sm w-full text-center"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
              style={{ background: 'rgba(59,130,246,0.1)', border: '2px solid rgba(59,130,246,0.28)' }}>
              🪪
            </div>

            <div>
              <p className="font-display font-black text-white text-xl">Face Scan Required</p>
              <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                GoodDollar uses a quick face scan to confirm you're a real person — not a bot. Takes under 60 seconds, and Valor stores nothing.
              </p>
            </div>

            {faceVerifyUrl ? (
              <a
                href={faceVerifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-4 font-display font-black uppercase tracking-widest text-sm rounded-xl flex items-center justify-center gap-2 text-white"
                style={{ background: '#3b82f6' }}
              >
                Start Face Scan <span className="opacity-70 text-base">↗</span>
              </a>
            ) : (
              <motion.button
                onClick={getFaceVerifyUrl}
                whileTap={{ scale: 0.97 }}
                className="w-full py-4 font-display font-black uppercase tracking-widest text-sm rounded-xl text-white"
                style={{ background: '#3b82f6' }}
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

        {/* ── WHITELISTED: success ─────────────────────────────────── */}
        {status === 'whitelisted' && (
          <motion.div
            key="done"
            className="relative z-10 flex flex-col items-center gap-4"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
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
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
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
