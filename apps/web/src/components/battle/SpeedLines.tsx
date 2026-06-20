'use client'

import { motion } from 'framer-motion'

interface Props {
  color: string
  direction: 'left' | 'right'
  intensity: 'light' | 'heavy' | 'special'
}

export default function SpeedLines({ color, direction, intensity }: Props) {
  const count = intensity === 'special' ? 12 : intensity === 'heavy' ? 8 : 5
  const xDir = direction === 'left' ? -1 : 1

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {Array.from({ length: count }).map((_, i) => {
        const y = 15 + (i / count) * 70
        const width = 30 + Math.random() * 40
        const delay = Math.random() * 0.05
        const thickness = intensity === 'special' ? 3 : intensity === 'heavy' ? 2 : 1

        return (
          <motion.div
            key={i}
            className="absolute"
            style={{
              top: `${y}%`,
              left: direction === 'right' ? '40%' : undefined,
              right: direction === 'left' ? '40%' : undefined,
              width: `${width}%`,
              height: thickness,
              background: `linear-gradient(${xDir > 0 ? '90deg' : '270deg'}, ${color}00, ${color}80, ${color}00)`,
              borderRadius: 2,
            }}
            initial={{ opacity: 0, x: 0, scaleX: 0 }}
            animate={{ opacity: [0, 0.8, 0], x: xDir * 60, scaleX: [0, 1, 1.5] }}
            transition={{ duration: 0.2, delay, ease: 'easeOut' }}
          />
        )
      })}
    </div>
  )
}
