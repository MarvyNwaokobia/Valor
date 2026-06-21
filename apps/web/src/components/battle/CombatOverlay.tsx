'use client'

import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  color: string | null
  intensity: 'critical' | 'ultimate' | null
  side?: 'player' | 'bot' | null
}

export default function CombatOverlay({ color, intensity, side }: Props) {
  if (!color || !intensity) return null
  const isUltimate = intensity === 'ultimate'
  const anchor = side === 'player' ? '0% 50%' : side === 'bot' ? '100% 50%' : '50% 50%'

  return (
    <AnimatePresence>
      <motion.div
        key={`${intensity}-${color}-${side ?? 'center'}`}
        className="absolute inset-0 pointer-events-none z-40"
        style={{
          background: isUltimate
            ? `radial-gradient(circle at ${anchor}, ${color}55, transparent 48%), rgba(255,255,255,0.12)`
            : `radial-gradient(circle at ${anchor}, rgba(255,255,255,0.26), ${color}28 24%, transparent 58%)`,
          mixBlendMode: 'screen',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: isUltimate ? [0, 1, 0.24, 0] : [0, 0.85, 0] }}
        exit={{ opacity: 0 }}
        transition={{ duration: isUltimate ? 0.42 : 0.22, ease: 'easeOut' }}
      />
    </AnimatePresence>
  )
}
