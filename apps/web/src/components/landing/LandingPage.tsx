'use client'

import { motion } from 'framer-motion'
import { useLogin } from '@privy-io/react-auth'
import { useMemo } from 'react'

// ─── Floating sparks ──────────────────────────────────────────────────────────

function useSparks() {
  return useMemo(() =>
    Array.from({ length: 26 }, (_, i) => ({
      id: i,
      left:     2  + ((i * 3.8)  % 96),
      delay:    (i * 0.48) % 11,
      duration: 4  + ((i * 0.72) % 5.5),
      size:     1  + (i % 4) * 0.6,
      drift:    Math.sin(i * 1.2) * 48,
      color: i % 4 === 0 ? 'rgba(251,191,36,0.9)'
           : i % 4 === 1 ? 'rgba(251,146,60,0.85)'
           : i % 4 === 2 ? 'rgba(239,68,68,0.7)'
           : 'rgba(180,100,20,0.75)',
    }))
  , [])
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { login } = useLogin()
  const sparks    = useSparks()

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ zIndex: 999, background: '#000' }}>

      {/* ════════════════════════════════════════════════
          BACKGROUND — full bleed, anchored to top so
          the storm sky is always in the upper zone and
          the characters occupy the lower 60%.
      ════════════════════════════════════════════════ */}
      <img
        src="/characters/Valor Landing Page.png"
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        style={{
          objectFit: 'cover',
          objectPosition: 'center top',
          filter: 'contrast(1.14) saturate(1.1) brightness(0.82)',
        }}
      />

      {/* ════════════════════════════════════════════════
          OVERLAYS — shape the light zones
      ════════════════════════════════════════════════ */}

      {/* Title zone: top 38% — dark enough for text, fades to transparent */}
      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{
        height: '38%',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)',
      }}/>

      {/* CTA zone: bottom 28% — dark ground for button */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{
        height: '28%',
        background: 'linear-gradient(0deg, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.7) 55%, transparent 100%)',
      }}/>

      {/* Corner vignette — frames the scene, kills hard edges */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 88% 88% at 50% 52%, transparent 40%, rgba(0,0,0,0.65) 100%)',
      }}/>

      {/* Left class glow — Berserker fire, boosts what's already there */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 35% 55% at 15% 80%, rgba(180,40,0,0.22) 0%, transparent 70%)',
      }}/>
      {/* Right class glow — Phantom purple */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 35% 55% at 85% 75%, rgba(100,20,180,0.22) 0%, transparent 70%)',
      }}/>

      {/* Scanlines — game texture */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px)',
      }}/>

      {/* ════════════════════════════════════════════════
          SPARKS — rise from the fire below
      ════════════════════════════════════════════════ */}
      {sparks.map(s => (
        <motion.div
          key={s.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${s.left}%`, bottom: 0,
            width: s.size, height: s.size,
            background: s.color,
            boxShadow: `0 0 3px ${s.color}`,
          }}
          animate={{ y: [0, -800 - s.id * 18], x: [0, s.drift], opacity: [0, 0.9, 0.5, 0.1, 0] }}
          transition={{ duration: s.duration, delay: s.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ════════════════════════════════════════════════
          CONTENT
      ════════════════════════════════════════════════ */}
      <div className="relative z-10 h-full flex flex-col items-center justify-between py-[6vh] px-4">

        {/* ── TITLE ZONE (top) ─────────────────────────
            Sits in the stormy sky above the characters.
            The glow spills DOWN onto them like firelight.
        ──────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2">

          {/* Pre-title rule */}
          <motion.div
            className="flex items-center gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.25 }}
          >
            <motion.div className="h-px w-16 md:w-24 bg-gradient-to-r from-transparent to-amber-500/50"
              initial={{ scaleX: 0, originX: 1 }} animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }} />
            <span className="text-[9px] md:text-[10px] tracking-[0.55em] uppercase font-bold text-amber-500/55">
              The Arena Awaits
            </span>
            <motion.div className="h-px w-16 md:w-24 bg-gradient-to-l from-transparent to-amber-500/50"
              initial={{ scaleX: 0, originX: 0 }} animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }} />
          </motion.div>

          {/* VALOR — each letter forges in */}
          <div
            className="font-display font-black leading-none tracking-[0.06em] flex select-none"
            style={{ fontSize: 'clamp(4.8rem, 16vw, 11.5rem)' }}
          >
            {'VALOR'.split('').map((letter, i) => (
              <motion.span
                key={i}
                style={{
                  display: 'inline-block',
                  background: 'linear-gradient(175deg, #fff5c0 0%, #fde047 22%, #eab308 52%, #b45309 80%, #7c2d12 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                }}
                initial={{ opacity: 0, y: -24, rotateX: -40 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.55, delay: 0.5 + i * 0.09, ease: [0.16, 1, 0.3, 1] }}
              >
                {letter}
              </motion.span>
            ))}
          </div>

          {/* Glow beneath title — spills down like firelight on the characters */}
          <motion.div
            className="pointer-events-none -mt-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 1.1 }}
            style={{
              width: 'clamp(280px, 65vw, 700px)',
              height: 80,
              background: 'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(234,179,8,0.45) 0%, rgba(180,80,0,0.15) 60%, transparent 100%)',
              filter: 'blur(6px)',
            }}
          />
        </div>

        {/* ── CHARACTER ZONE (middle) ──────────────────
            Characters show through here — NO text, NO elements
            This is intentionally empty.
        ──────────────────────────────────────────────── */}
        <div className="flex-1" />

        {/* ── CTA ZONE (bottom) ────────────────────────
            In the dark ground zone below the characters.
        ──────────────────────────────────────────────── */}
        <motion.div
          className="flex flex-col items-center gap-3 w-full"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.3 }}
        >
          {/* Tagline */}
          <p className="text-slate-500 tracking-[0.32em] uppercase text-[10px] md:text-xs">
            Warriors fight · Legends earn
          </p>

          {/* Class badges */}
          <div className="flex items-center gap-2">
            {[
              { name:'Berserker', color:'#ef4444' },
              { name:'Sentinel',  color:'#3b82f6' },
              { name:'Phantom',   color:'#8b5cf6' },
            ].map((cls, i) => (
              <motion.span
                key={cls.name}
                className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border"
                style={{ color:cls.color, borderColor:`${cls.color}35`, background:`${cls.color}10` }}
                initial={{ opacity:0, scale:0.85 }}
                animate={{ opacity:1, scale:1 }}
                transition={{ delay: 1.5 + i * 0.1 }}
              >
                {cls.name}
              </motion.span>
            ))}
          </div>

          {/* Enter Valor */}
          <motion.button
            onClick={() => login()}
            whileHover={{ scale: 1.05, boxShadow: '0 0 60px rgba(234,179,8,0.7), 0 0 120px rgba(234,179,8,0.25)' }}
            whileTap={{ scale: 0.96 }}
            className="relative overflow-hidden font-display font-black text-black uppercase tracking-[0.22em] px-14 py-4 text-sm md:text-base"
            style={{
              background: 'linear-gradient(135deg, #fef9c3 0%, #fde047 25%, #eab308 60%, #b45309 100%)',
              clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)',
              boxShadow: '0 0 45px rgba(234,179,8,0.55), 0 0 90px rgba(234,179,8,0.18), 0 6px 28px rgba(0,0,0,0.9)',
            }}
          >
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.3) 50%, transparent 70%)' }}
              animate={{ x: ['-120%', '200%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 2.5 }}
            />
            Enter Valor
          </motion.button>

          <p className="text-slate-700 text-[8px] tracking-[0.4em] uppercase">
            Powered by GoodDollar · Verified Humans Only
          </p>
        </motion.div>

      </div>
    </div>
  )
}
