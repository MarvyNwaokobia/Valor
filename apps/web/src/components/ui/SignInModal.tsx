'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMagicAuthContext } from '@/components/providers/MagicAuthProvider'

interface Props {
  onClose: () => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function SignInModal({ onClose }: Props) {
  const { loginWithEmailOTP, loginWithGoogle } = useMagicAuthContext()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState<'email' | 'google' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleEmail() {
    if (!EMAIL_RE.test(email) || pending) return
    setPending('email')
    setError(null)
    try {
      // Magic shows its own OTP-entry modal on top of this one and resolves
      // once the user enters the code — nothing else to build here.
      await loginWithEmailOTP(email)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed — try again.')
    } finally {
      setPending(null)
    }
  }

  async function handleGoogle() {
    if (pending) return
    setPending('google')
    setError(null)
    try {
      await loginWithGoogle() // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed — try again.')
      setPending(null)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <motion.div
        className="relative w-full max-w-sm rounded-2xl border border-valor-border bg-valor-surface p-6 flex flex-col gap-5"
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 16 }}
      >
        <div>
          <h2 className="font-display font-black text-white text-xl">Enter Valor</h2>
          <p className="text-slate-400 text-sm mt-1">
            One human, one fighter. Sign in to forge your warrior.
          </p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={!!pending}
          className="flex items-center justify-center gap-2.5 w-full py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-slate-100 transition-colors disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.68-3.87 2.68-6.62Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
          </svg>
          {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-valor-border" />
          <span className="text-[10px] uppercase tracking-widest text-slate-600 font-bold">or</span>
          <div className="flex-1 h-px bg-valor-border" />
        </div>

        <div className="flex flex-col gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
            className="w-full px-3.5 py-3 rounded-xl bg-valor-surface-2 border border-valor-border text-white font-medium text-sm placeholder:text-slate-600 focus:outline-none focus:border-valor-gold/60 transition-colors"
            onKeyDown={e => { if (e.key === 'Enter') handleEmail() }}
            disabled={!!pending}
          />
          <button
            onClick={handleEmail}
            disabled={!EMAIL_RE.test(email) || !!pending}
            className="w-full py-3 rounded-xl bg-valor-gold text-black font-bold text-sm hover:bg-valor-gold-light transition-colors disabled:opacity-40"
          >
            {pending === 'email' ? 'Sending code…' : 'Continue with Email'}
          </button>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="text-red-400 text-xs font-medium -mt-2"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <button
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  )
}
