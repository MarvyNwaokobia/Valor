'use client'

import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  active: boolean
  side: 'player' | 'bot'
  color: string
  special?: boolean
}

export default function WeaponTrail({ active, side, color, special = false }: Props) {
  const direction = side === 'player' ? 1 : -1
  const origin = side === 'player' ? '38%' : '62%'
  const width = special ? 240 : 170
  const height = special ? 110 : 78

  return (
    <AnimatePresence>
      {active && (
        <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                left: origin,
                top: special ? '35%' : '39%',
                width,
                height,
                borderTop: `${special ? 5 : 3}px solid ${i === 0 ? '#fff' : color}`,
                borderRight: `${special ? 2 : 1}px solid ${color}`,
                filter: `drop-shadow(0 0 ${special ? 18 : 10}px ${color})`,
                transformOrigin: side === 'player' ? '0% 50%' : '100% 50%',
                mixBlendMode: 'screen',
              }}
              initial={{
                opacity: i === 0 ? 0.95 : 0.55,
                x: direction * -70,
                y: i * 10 - 8,
                rotate: direction * (-34 - i * 7),
                scaleX: 0.25,
                scaleY: 0.72 + i * 0.12,
              }}
              animate={{
                opacity: 0,
                x: direction * (special ? 96 : 64),
                y: i * 5 - 16,
                rotate: direction * (22 + i * 9),
                scaleX: special ? 1.25 : 1,
                scaleY: 1,
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: special ? 0.34 : 0.23,
                delay: i * 0.025,
                ease: [0.12, 0.9, 0.18, 1],
              }}
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  )
}
