'use client'

import { motion } from 'framer-motion'

// Placeholder: login is being rebuilt from scratch (Web3Auth removed
// 2026-07-04). Nothing is wired up behind this button yet.
export function ConnectButton() {
  return (
    <motion.button
      onClick={() => alert('Sign-in is being rebuilt — check back soon.')}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="px-4 py-2 bg-valor-gold text-black font-bold rounded-xl text-sm hover:bg-valor-gold-light transition-colors shadow-[0_0_12px_rgba(234,179,8,0.25)]"
    >
      Enter Valor
    </motion.button>
  )
}
