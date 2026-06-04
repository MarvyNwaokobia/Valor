'use client'

import { motion } from 'framer-motion'
import { useLogin } from '@privy-io/react-auth'
import { useMemo } from 'react'

const EMBER_COUNT = 18

function useEmbers() {
  return useMemo(
    () =>
      Array.from({ length: EMBER_COUNT }, (_, i) => ({
        id: i,
        left: 2 + ((i * 5.2) % 96),
        delay: (i * 0.6) % 12,
        duration: 5 + ((i * 0.7) % 6),
        size: 1.5 + (i % 3) * 0.7,
        drift: Math.sin(i * 0.9) * 45,
        color:
          i % 3 === 0
            ? 'rgba(251,191,36,0.8)'
            : i % 3 === 1
              ? 'rgba(251,146,60,0.8)'
              : 'rgba(239,68,68,0.65)',
      })),
    [],
  )
}

export default function LandingPage() {
  const { login } = useLogin()
  const embers = useEmbers()

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #03030a 0%, #060410 55%, #0a0408 100%)', zIndex: 999 }}
    >
      {/* ── TRI-CLASS ATMOSPHERE GLOW ── */}
      {/* Red/fire — Berserker, left */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 55% 70% at 18% 85%, rgba(200,40,0,0.38) 0%, transparent 65%)',
      }}/>
      {/* Blue/lightning — Sentinel, center */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 50% 65% at 50% 90%, rgba(30,80,200,0.28) 0%, transparent 60%)',
      }}/>
      {/* Purple/shadow — Phantom, right */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 50% 65% at 82% 85%, rgba(120,40,220,0.32) 0%, transparent 62%)',
      }}/>
      {/* Top vignette */}
      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{
        height: 140,
        background: 'linear-gradient(180deg, rgba(3,3,10,0.85) 0%, transparent 100%)',
      }}/>

      {/* ── EMBERS ── */}
      {embers.map((e) => (
        <motion.div
          key={e.id}
          className="absolute rounded-full pointer-events-none"
          style={{ left: `${e.left}%`, bottom: -8, width: e.size, height: e.size, background: e.color }}
          animate={{ y: [0, -1200], x: [0, e.drift], opacity: [0, 0.9, 0.6, 0.2, 0] }}
          transition={{ duration: e.duration, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ── CONTENT ── */}
      <div className="relative z-10 flex flex-col items-center h-full">

        {/* TITLE */}
        <div className="flex flex-col items-center pt-[9vh] gap-2.5 shrink-0">
          <motion.div
            className="flex items-center gap-4"
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <div className="h-px w-10 md:w-16 bg-gradient-to-r from-transparent to-valor-gold/50" />
            <span className="text-[9px] md:text-[10px] tracking-[0.45em] text-valor-gold/55 uppercase font-semibold">
              The Arena Awaits
            </span>
            <div className="h-px w-10 md:w-16 bg-gradient-to-l from-transparent to-valor-gold/50" />
          </motion.div>

          <motion.h1
            className="font-display font-black text-valor-gold tracking-[0.14em] leading-none"
            style={{
              fontSize: 'clamp(4.5rem, 15vw, 10rem)',
              textShadow: '0 0 40px rgba(234,179,8,0.85), 0 0 90px rgba(234,179,8,0.3), 0 0 180px rgba(234,179,8,0.1)',
            }}
            initial={{ opacity: 0, y: -28, scale: 1.15 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.75, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            VALOR
          </motion.h1>

          <motion.p
            className="text-slate-500 tracking-[0.28em] uppercase text-xs mt-0.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 1.0 }}
          >
            Warriors fight · Legends earn
          </motion.p>
        </div>

        {/* HERO CHARACTER ART */}
        <div className="flex-1 flex items-end justify-center w-full relative min-h-0">
          {/* Ground glow line */}
          <div
            className="absolute pointer-events-none z-20"
            style={{
              bottom: '20%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '80%',
              maxWidth: 480,
              height: 1,
              background:
                'linear-gradient(90deg, rgba(200,40,0,0.5) 0%, rgba(234,179,8,0.8) 35%, rgba(255,255,255,0.9) 50%, rgba(234,179,8,0.8) 65%, rgba(120,40,220,0.5) 100%)',
              boxShadow: '0 0 20px rgba(234,179,8,0.45), 0 0 50px rgba(234,179,8,0.15)',
            }}
          />

          {/* Character group image */}
          <motion.div
            className="relative w-full h-full flex items-end justify-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.1, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <img
              src="/characters/Charcters for landing page.png"
              alt="Valor Warriors"
              className="relative z-10 w-auto select-none"
              draggable={false}
              style={{
                height: 'clamp(320px, 52vh, 560px)',
                objectFit: 'contain',
                objectPosition: 'bottom center',
                filter: 'drop-shadow(0 0 30px rgba(234,179,8,0.3)) drop-shadow(0 30px 60px rgba(0,0,0,0.99))',
              }}
            />
            {/* Bottom fade — blends feet into ground */}
            <div
              className="absolute bottom-0 inset-x-0 z-20 pointer-events-none"
              style={{
                height: '28%',
                background: 'linear-gradient(0deg, rgba(3,3,10,0.95) 0%, rgba(3,3,10,0.6) 40%, transparent 100%)',
              }}
            />
          </motion.div>
        </div>

        {/* CTA */}
        <motion.div
          className="pb-10 md:pb-14 flex flex-col items-center gap-3 shrink-0 relative z-30"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.3 }}
        >
          <motion.button
            onClick={() => login()}
            whileHover={{ scale: 1.06, filter: 'brightness(1.18)' }}
            whileTap={{ scale: 0.95 }}
            className="px-12 py-4 font-display font-bold text-black uppercase tracking-[0.18em] text-sm md:text-base relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #fde047 0%, #eab308 50%, #b45309 100%)',
              clipPath: 'polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%)',
              boxShadow: '0 0 35px rgba(234,179,8,0.5), 0 0 70px rgba(234,179,8,0.15)',
            }}
          >
            {/* Shimmer */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)' }}
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'linear', repeatDelay: 1.5 }}
            />
            Enter Valor
          </motion.button>
          <p className="text-slate-700 text-[9px] tracking-[0.35em] uppercase">
            Powered by GoodDollar · Verified Humans Only
          </p>
        </motion.div>
      </div>
    </div>
  )
}
