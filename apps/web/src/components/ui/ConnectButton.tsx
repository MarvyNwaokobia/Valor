'use client'

import { useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { motion } from 'framer-motion'
import SignInPanel, { OAUTH_PENDING_KEY } from '@/components/auth/SignInPanel'

export function ConnectButton() {
  const { address, status } = useAccount()
  const { disconnect } = useDisconnect()
  // Redirect-mode OAuth does a full page navigation away and back — the whole
  // React tree remounts on return, so a plain `useState(false)` here would
  // never re-show the panel and its OAuth-return handling would never run.
  // Re-derive from the pending flag SignInPanel itself sets before redirecting.
  const [showSignIn, setShowSignIn] = useState(() =>
    typeof window !== 'undefined' && !!sessionStorage.getItem(OAUTH_PENDING_KEY),
  )

  const ready = status !== 'connecting' && status !== 'reconnecting'
  const authenticated = status === 'connected'

  // Web3Auth not yet initialised — show skeleton to prevent layout shift
  if (!ready) {
    return <div className="w-28 h-9 rounded-xl bg-valor-surface-2 animate-pulse" />
  }

  if (!authenticated) {
    return (
      <>
        <motion.button
          onClick={() => setShowSignIn(true)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-4 py-2 bg-valor-gold text-black font-bold rounded-xl text-sm hover:bg-valor-gold-light transition-colors shadow-[0_0_12px_rgba(234,179,8,0.25)]"
        >
          Enter Valor
        </motion.button>
        {showSignIn && <SignInPanel onClose={() => setShowSignIn(false)} />}
      </>
    )
  }

  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : '—'

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:block text-xs text-slate-400 font-mono bg-valor-surface-2 px-2.5 py-1.5 rounded-lg border border-valor-border">
        {shortAddress}
      </span>
      <button
        onClick={() => disconnect()}
        className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-valor-surface-2"
      >
        Sign Out
      </button>
    </div>
  )
}
