'use client'

import { motion } from 'framer-motion'

interface Props {
  color: string
  intensity: 'light' | 'heavy' | 'ko'
}

export default function ScreenFlash({ color, intensity }: Props) {
  const maxOpacity = intensity === 'ko' ? 0.6 : intensity === 'heavy' ? 0.3 : 0.15
  const duration = intensity === 'ko' ? 0.5 : intensity === 'heavy' ? 0.25 : 0.15

  return (
    <motion.div
      className="absolute inset-0 pointer-events-none z-50"
      style={{ background: color }}
      initial={{ opacity: maxOpacity }}
      animate={{ opacity: 0 }}
      transition={{ duration, ease: 'easeOut' }}
    />
  )
}
