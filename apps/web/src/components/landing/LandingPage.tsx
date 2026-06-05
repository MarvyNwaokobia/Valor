'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useLogin } from '@privy-io/react-auth'

// These images already exist in public/ — no external requests, instant load.
const BERSERKER = '/characters/Valor%20Characters/Characters/berserkers%20male-nobackground.png'
const SENTINEL  = '/characters/Valor%20Characters/Sentinel-withoutback.jpg'
const PHANTOM   = '/characters/Valor%20Characters/Characters/Phanthom%20male-no%20background.png'

function useEmbers() {
  return useMemo(() =>
    Array.from({ length: 18 }, (_, i) => ({
      id:       i,
      left:     2 + ((i * 3.8) % 26),
      delay:    (i * 0.52) % 10,
      duration: 3.2 + ((i * 0.7) % 5),
      size:     0.9 + (i % 4) * 0.5,
      drift:    Math.sin(i * 1.2) * 28,
      color:
        i % 4 === 0 ? 'rgba(255,200,50,0.95)' :
        i % 4 === 1 ? 'rgba(239,68,68,0.85)'  :
        i % 4 === 2 ? 'rgba(255,140,30,0.78)' :
                      'rgba(180,60,0,0.7)',
    }))
  , [])
}

export default function LandingPage() {
  const { login } = useLogin()
  const embers    = useEmbers()

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#04030c', zIndex: 999 }}>

      {/* ── Atmosphere ─────────────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 55% 70% at 8% 90%, rgba(180,28,0,0.5) 0%, transparent 65%)' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 42% 50% at 50% 88%, rgba(30,70,200,0.3) 0%, transparent 65%)' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 55% 70% at 92% 90%, rgba(90,12,190,0.48) 0%, transparent 65%)' }} />

      {/* ── Characters ─────────────────────────────────────────────── */}

      {/* MOBILE: Sentinel hero, full viewport */}
      <motion.img
        src={SENTINEL}
        alt=""
        aria-hidden
        className="md:hidden absolute inset-0 w-full h-full object-cover object-top"
        style={{ mixBlendMode: 'screen', filter: 'brightness(1.4) contrast(1.08) saturate(1.1)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.3 }}
      />

      {/* DESKTOP: Berserker left */}
      <motion.img
        src={BERSERKER}
        alt=""
        aria-hidden
        className="hidden md:block absolute bottom-0 left-0 h-[88%] w-auto object-contain object-bottom"
        style={{
          filter: 'drop-shadow(0 0 40px rgba(239,68,68,0.55)) brightness(1.15)',
          WebkitMaskImage: 'linear-gradient(to right, black 0%, black 65%, transparent 100%), linear-gradient(to top, black 0%, black 78%, transparent 100%)',
          maskImage: 'linear-gradient(to right, black 0%, black 65%, transparent 100%), linear-gradient(to top, black 0%, black 78%, transparent 100%)',
          WebkitMaskComposite: 'source-in',
          maskComposite: 'intersect',
        }}
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* DESKTOP: Sentinel center hero */}
      <motion.img
        src={SENTINEL}
        alt=""
        aria-hidden
        className="hidden md:block absolute bottom-0 left-1/2 -translate-x-1/2 h-[92%] w-auto object-contain object-bottom"
        style={{
          mixBlendMode: 'screen',
          filter: 'brightness(1.35) contrast(1.1) drop-shadow(0 0 50px rgba(59,130,246,0.6))',
        }}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* DESKTOP: Phantom right */}
      <motion.img
        src={PHANTOM}
        alt=""
        aria-hidden
        className="hidden md:block absolute bottom-0 right-0 h-[88%] w-auto object-contain object-bottom"
        style={{
          filter: 'drop-shadow(0 0 40px rgba(139,92,246,0.6)) brightness(1.1)',
          WebkitMaskImage: 'linear-gradient(to left, black 0%, black 65%, transparent 100%), linear-gradient(to top, black 0%, black 78%, transparent 100%)',
          maskImage: 'linear-gradient(to left, black 0%, black 65%, transparent 100%), linear-gradient(to top, black 0%, black 78%, transparent 100%)',
          WebkitMaskComposite: 'source-in',
          maskComposite: 'intersect',
        }}
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* ── Overlays ───────────────────────────────────────────────── */}
      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: '40%', background: 'linear-gradient(180deg, rgba(4,3,12,0.97) 0%, rgba(4,3,12,0.65) 50%, transparent 100%)' }} />
      <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ height: '38%', background: 'linear-gradient(0deg, rgba(4,3,12,0.98) 0%, rgba(4,3,12,0.75) 55%, transparent 100%)' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 90% 88% at 50% 50%, transparent 40%, rgba(4,3,12,0.65) 100%)' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.025) 2px, rgba(0,0,0,0.025) 4px)' }} />

      {/* ── Weather ────────────────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'repeating-linear-gradient(168deg, transparent 0px, transparent 5px, rgba(160,200,255,0.04) 5px, rgba(160,200,255,0.04) 6px)', backgroundSize: '6px 80px', animation: 'rain-fall 0.5s linear infinite' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 45% 75% at 50% 28%, rgba(70,120,255,0.09), transparent 60%)', animation: 'lightning-flash 8s ease-in-out infinite', animationDelay: '3.2s' }} />

      {/* ── Embers ─────────────────────────────────────────────────── */}
      {embers.map(e => (
        <motion.div
          key={e.id}
          className="absolute rounded-full pointer-events-none"
          style={{ left: `${e.left}%`, bottom: '16%', width: e.size, height: e.size, background: e.color, boxShadow: `0 0 ${e.size * 3}px ${e.color}` }}
          animate={{ y: [0, -(560 + e.id * 18)], x: [0, e.drift], opacity: [0, 0.9, 0.55, 0.15, 0] }}
          transition={{ duration: e.duration, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ── Content ────────────────────────────────────────────────── */}
      <div className="relative z-10 h-full flex flex-col items-center justify-between px-5" style={{ paddingTop: 'clamp(2.5vh, 4.5vh, 6vh)', paddingBottom: 'clamp(3vh, 5vh, 7vh)' }}>

        {/* Title */}
        <div className="flex flex-col items-center gap-1.5">
          <motion.div className="flex items-center gap-2.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.25 }}>
            <div style={{ height: 1, width: 'clamp(36px,7vw,80px)', background: 'linear-gradient(to right, transparent, rgba(234,179,8,0.55))' }} />
            <span className="font-display font-bold uppercase" style={{ fontSize: 'clamp(7px,1.3vw,10px)', letterSpacing: '0.5em', color: 'rgba(234,179,8,0.5)' }}>The Arena Awaits</span>
            <div style={{ height: 1, width: 'clamp(36px,7vw,80px)', background: 'linear-gradient(to left, transparent, rgba(234,179,8,0.55))' }} />
          </motion.div>

          <div className="font-display font-black leading-none flex select-none" style={{ fontSize: 'clamp(5rem,19vw,12.5rem)', letterSpacing: '0.05em' }}>
            {'VALOR'.split('').map((letter, i) => (
              <motion.span key={i} style={{ display: 'inline-block', background: 'linear-gradient(175deg, #fffbe0 0%, #fde047 18%, #eab308 48%, #b45309 76%, #7c2d12 100%)', backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 28px rgba(234,179,8,0.45)) drop-shadow(0 2px 6px rgba(0,0,0,0.9))' }}
                initial={{ opacity: 0, y: -18, rotateX: -35 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ duration: 0.5, delay: 0.52 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}>
                {letter}
              </motion.span>
            ))}
          </div>
        </div>

        <div className="flex-1" />

        {/* CTA */}
        <motion.div className="flex flex-col items-center gap-3 w-full" style={{ maxWidth: 'clamp(270px,82vw,380px)' }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 1.3 }}>
          <p className="font-display font-bold uppercase" style={{ fontSize: 'clamp(8px,1.5vw,10px)', letterSpacing: '0.35em', color: 'rgba(100,116,139,0.72)' }}>
            Warriors fight · Legends earn
          </p>
          <div className="flex items-center gap-2">
            {([{ name: 'Berserker', color: '#ef4444' }, { name: 'Sentinel', color: '#3b82f6' }, { name: 'Phantom', color: '#8b5cf6' }] as const).map(({ name, color }, i) => (
              <motion.span key={name} className="font-display font-black uppercase rounded-full border" style={{ fontSize: '9px', letterSpacing: '0.16em', padding: '4px 10px', color, borderColor: `${color}28`, background: `${color}0e` }}
                initial={{ opacity: 0, scale: 0.84 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.5 + i * 0.09, duration: 0.3 }}>
                {name}
              </motion.span>
            ))}
          </div>
          <motion.button onClick={() => login()} className="relative overflow-hidden font-display font-black uppercase w-full"
            style={{ fontSize: 'clamp(12px,2.4vw,15px)', letterSpacing: '0.24em', color: '#080610', padding: 'clamp(15px,3vw,19px) 0', background: 'linear-gradient(135deg, #fefce8 0%, #fde047 20%, #eab308 55%, #ca8a04 80%, #92400e 100%)', clipPath: 'polygon(14px 0%, 100% 0%, calc(100% - 14px) 100%, 0% 100%)', boxShadow: '0 0 36px rgba(234,179,8,0.5), 0 0 72px rgba(234,179,8,0.16), 0 8px 24px rgba(0,0,0,0.95)' }}
            whileHover={{ scale: 1.03, boxShadow: '0 0 56px rgba(234,179,8,0.68), 0 0 100px rgba(234,179,8,0.22), 0 8px 32px rgba(0,0,0,0.95)' }}
            whileTap={{ scale: 0.97 }}>
            <motion.div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(108deg, transparent 28%, rgba(255,255,255,0.3) 50%, transparent 72%)' }} animate={{ x: ['-140%', '220%'] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear', repeatDelay: 3.2 }} />
            Enter Valor
          </motion.button>
          <p className="text-center uppercase" style={{ fontSize: '8px', letterSpacing: '0.36em', color: 'rgba(71,85,105,0.6)' }}>
            Powered by GoodDollar · Verified Humans Only
          </p>
        </motion.div>
      </div>
    </div>
  )
}
