'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LogOut } from 'lucide-react'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useMagicAuthContext } from '@/components/providers/MagicAuthProvider'
import SignInModal from './SignInModal'

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function ConnectButton() {
  const { status, address } = useResolvedAuth()
  const { logout } = useMagicAuthContext()
  const [showModal, setShowModal] = useState(false)

  if (status === 'ready' && address) {
    return (
      <button
        onClick={logout}
        title="Sign out"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:text-white transition-colors"
        style={{ background: 'rgba(26,26,40,0.8)', border: '1px solid rgba(42,42,58,0.8)' }}
      >
        <span className="font-mono">{truncate(address)}</span>
        <LogOut size={13} />
      </button>
    )
  }

  return (
    <>
      <motion.button
        onClick={() => setShowModal(true)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        disabled={status === 'loading'}
        className="px-4 py-2 bg-valor-gold text-black font-bold rounded-xl text-sm hover:bg-valor-gold-light transition-colors shadow-[0_0_12px_rgba(234,179,8,0.25)] disabled:opacity-60"
      >
        Enter Valor
      </motion.button>
      <AnimatePresence>
        {showModal && <SignInModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </>
  )
}
