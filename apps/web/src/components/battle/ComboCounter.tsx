'use client'

import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  count: number
  color: string
}

export default function ComboCounter({ count, color }: Props) {
  return (
    <AnimatePresence>
      {count >= 2 && (
        <motion.div
          key={count}
          className="absolute left-1/2 top-[18%] z-50 pointer-events-none select-none text-center"
          style={{ transform: 'translateX(-50%)' }}
          initial={{ opacity: 0, y: 12, scale: 0.72 }}
          animate={{ opacity: 1, y: 0, scale: [1.22, 1] }}
          exit={{ opacity: 0, y: -12, scale: 0.85 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <p
            className="font-display font-black uppercase leading-none"
            style={{
              color,
              fontSize: 'clamp(1.6rem, 6vw, 3rem)',
              textShadow: `0 0 22px ${color}, 0 3px 8px rgba(0,0,0,0.9)`,
              letterSpacing: '0.05em',
            }}
          >
            {count} HIT
          </p>
          <p className="text-[9px] font-black uppercase tracking-[0.35em] text-white/50">
            Combo
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
