'use client'

import { motion } from 'framer-motion'

interface Props {
  color: string
  size: 'small' | 'medium' | 'large'
}

export default function GroundShockwave({ color, size }: Props) {
  const scale = size === 'large' ? 3 : size === 'medium' ? 2 : 1.2
  const ringCount = size === 'large' ? 3 : size === 'medium' ? 2 : 1

  return (
    <div className="absolute pointer-events-none" style={{ transform: 'translate(-50%, -50%)' }}>
      {Array.from({ length: ringCount }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 40,
            height: 40,
            left: -20,
            top: -20,
            border: `${2 - i * 0.5}px solid ${color}`,
            boxShadow: `0 0 ${10 + i * 5}px ${color}60`,
          }}
          initial={{ scale: 0, opacity: 0.9 }}
          animate={{ scale: scale + i * 0.8, opacity: 0 }}
          transition={{ duration: 0.4 + i * 0.1, delay: i * 0.06, ease: 'easeOut' }}
        />
      ))}
      {/* Center flash */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 16,
          height: 16,
          left: -8,
          top: -8,
          background: `radial-gradient(circle, ${color}, transparent)`,
        }}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: scale * 0.6, opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      />
    </div>
  )
}
