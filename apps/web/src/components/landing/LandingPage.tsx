'use client'

import { motion } from 'framer-motion'
import { useLogin } from '@privy-io/react-auth'
import { useMemo } from 'react'

const SPARK_COUNT = 22

function useSparks() {
  return useMemo(() =>
    Array.from({ length: SPARK_COUNT }, (_, i) => ({
      id: i,
      left: 2 + ((i * 4.4) % 96),
      delay: (i * 0.55) % 10,
      duration: 4 + ((i * 0.7) % 5),
      size: 1.2 + (i % 4) * 0.65,
      drift: Math.sin(i * 1.1) * 55,
      color: i % 4 === 0 ? 'rgba(251,191,36,0.9)'
           : i % 4 === 1 ? 'rgba(251,146,60,0.85)'
           : i % 4 === 2 ? 'rgba(239,68,68,0.7)'
           : 'rgba(251,220,100,0.75)',
    }))
  , [])
}

export default function LandingPage() {
  const { login } = useLogin()
  const sparks = useSparks()

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ zIndex: 999, background: '#000' }}>

      {/* ══════════════════════════════════════════════
          LAYER 1 — FULL BLEED CHARACTER ART
          Characters ARE the page. No small image.
      ══════════════════════════════════════════════ */}
      <img
        src="/characters/Charcters for landing page.png"
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full select-none pointer-events-none"
        style={{
          objectFit: 'cover',
          objectPosition: 'center 55%',
          filter: 'contrast(1.12) saturate(1.08) brightness(0.88)',
        }}
      />

      {/* ══════════════════════════════════════════════
          LAYER 2 — CINEMATIC OVERLAYS
      ══════════════════════════════════════════════ */}

      {/* Corner vignette — pulls eyes to center */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 85% 85% at 50% 50%, transparent 38%, rgba(0,0,0,0.72) 100%)',
      }}/>

      {/* Top fade — deep black into scene */}
      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{
        height: '42%',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.65) 40%, rgba(0,0,0,0.1) 75%, transparent 100%)',
      }}/>

      {/* Bottom fade — scene into black */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{
        height: '38%',
        background: 'linear-gradient(0deg, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.75) 45%, rgba(0,0,0,0.1) 80%, transparent 100%)',
      }}/>

      {/* Scanlines — gives it a raw, gritty game feel */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)',
        mixBlendMode: 'multiply',
      }}/>

      {/* Side darkness — letterbox feel */}
      <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: '8%', background: 'linear-gradient(90deg, rgba(0,0,0,0.55), transparent)' }}/>
      <div className="absolute inset-y-0 right-0 pointer-events-none" style={{ width: '8%', background: 'linear-gradient(270deg, rgba(0,0,0,0.55), transparent)' }}/>

      {/* ══════════════════════════════════════════════
          LAYER 3 — EMBER SPARKS
      ══════════════════════════════════════════════ */}
      {sparks.map(s => (
        <motion.div
          key={s.id}
          className="absolute rounded-full pointer-events-none"
          style={{ left: `${s.left}%`, bottom: 0, width: s.size, height: s.size, background: s.color, boxShadow: `0 0 4px ${s.color}` }}
          animate={{ y: [0, -900 - Math.random()*400], x: [0, s.drift], opacity: [0, 0.95, 0.6, 0.1, 0] }}
          transition={{ duration: s.duration, delay: s.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ══════════════════════════════════════════════
          LAYER 4 — CONTENT
      ══════════════════════════════════════════════ */}
      <div className="relative z-20 h-full flex flex-col items-center">

        {/* ── TOP: VALOR TITLE ── */}
        <div className="flex flex-col items-center pt-[7vh] px-4">

          {/* Pre-title */}
          <motion.div
            className="flex items-center gap-3 mb-3"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <motion.div
              className="h-px bg-gradient-to-r from-transparent via-valor-gold/60 to-transparent"
              style={{ width: 'clamp(40px, 8vw, 80px)' }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            />
            <span className="text-[9px] md:text-[10px] tracking-[0.52em] uppercase font-bold" style={{ color: 'rgba(234,179,8,0.6)' }}>
              The Arena Awaits
            </span>
            <motion.div
              className="h-px bg-gradient-to-r from-transparent via-valor-gold/60 to-transparent"
              style={{ width: 'clamp(40px, 8vw, 80px)' }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            />
          </motion.div>

          {/* VALOR — each letter animates in */}
          <h1
            className="font-display font-black leading-none tracking-[0.08em] flex"
            style={{ fontSize: 'clamp(5.5rem, 18vw, 13rem)' }}
          >
            {'VALOR'.split('').map((letter, i) => (
              <motion.span
                key={i}
                style={{
                  display: 'inline-block',
                  color: 'transparent',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  backgroundImage: 'linear-gradient(180deg, #fef08a 0%, #eab308 45%, #b45309 100%)',
                  textShadow: 'none',
                  filter: 'drop-shadow(0 0 30px rgba(234,179,8,0.9)) drop-shadow(0 0 70px rgba(234,179,8,0.45)) drop-shadow(0 4px 12px rgba(0,0,0,0.8))',
                }}
                initial={{ opacity: 0, y: -40, scale: 1.3, filter: 'blur(12px) drop-shadow(0 0 0px rgba(234,179,8,0))' }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'drop-shadow(0 0 30px rgba(234,179,8,0.9)) drop-shadow(0 0 70px rgba(234,179,8,0.45)) drop-shadow(0 4px 12px rgba(0,0,0,0.8))' }}
                transition={{ duration: 0.6, delay: 0.5 + i * 0.09, ease: [0.16, 1, 0.3, 1] }}
              >
                {letter}
              </motion.span>
            ))}
          </h1>

          {/* Subtitle */}
          <motion.p
            className="text-slate-400 tracking-[0.32em] uppercase mt-2"
            style={{ fontSize: 'clamp(0.62rem, 1.8vw, 0.85rem)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.1 }}
          >
            Warriors fight · Legends earn
          </motion.p>
        </div>

        {/* ── MIDDLE: CHARACTERS SHOW THROUGH ── */}
        <div className="flex-1" />

        {/* ── BOTTOM: CTA ── */}
        <motion.div
          className="pb-10 md:pb-16 flex flex-col items-center gap-4 px-6 w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1.35 }}
        >
          {/* Class teaser badges */}
          <motion.div
            className="flex items-center gap-2 mb-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6 }}
          >
            {[
              { name: 'Berserker', color: '#ef4444' },
              { name: 'Sentinel',  color: '#3b82f6' },
              { name: 'Phantom',   color: '#8b5cf6' },
            ].map((cls, i) => (
              <motion.span
                key={cls.name}
                className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border"
                style={{
                  color: cls.color,
                  borderColor: `${cls.color}40`,
                  background: `${cls.color}12`,
                }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.65 + i * 0.1 }}
              >
                {cls.name}
              </motion.span>
            ))}
          </motion.div>

          {/* Main CTA */}
          <motion.button
            onClick={() => login()}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            className="relative overflow-hidden font-display font-black text-black uppercase tracking-[0.2em] px-16 py-4 text-base md:text-lg"
            style={{
              background: 'linear-gradient(135deg, #fef08a 0%, #eab308 40%, #b45309 100%)',
              clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)',
              boxShadow: '0 0 50px rgba(234,179,8,0.6), 0 0 100px rgba(234,179,8,0.2), 0 8px 32px rgba(0,0,0,0.8)',
            }}
          >
            {/* Shimmer sweep */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.35) 50%, transparent 65%)' }}
              animate={{ x: ['-100%', '180%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 2 }}
            />
            Enter Valor
          </motion.button>

          <p className="text-slate-600 text-[8px] tracking-[0.42em] uppercase">
            Powered by GoodDollar · Verified Humans Only
          </p>
        </motion.div>
      </div>

    </div>
  )
}
