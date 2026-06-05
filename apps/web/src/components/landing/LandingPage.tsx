'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLogin } from '@privy-io/react-auth'
import { buildPortraitUrl } from '@/components/onboarding/AvatarGenerator'
import type { CharacterClass } from '@/lib/classes'

// Fixed seeds produce consistent portraits on every visit.
// After Pollinations generates them once, they're served from cache instantly.
const SHOWCASE: {
  cls:    CharacterClass
  gender: 'male' | 'female'
  skin:   string
  armor:  'battle-worn' | 'pristine' | 'runic'
  seed:   string
  color:  string
  glow:   string
}[] = [
  { cls: 'Berserker', gender: 'male',   skin: '#a0612a', armor: 'battle-worn', seed: '0x00000001', color: '#ef4444', glow: 'rgba(239,68,68,0.45)'   },
  { cls: 'Sentinel',  gender: 'male',   skin: '#fde8d5', armor: 'pristine',    seed: '0x00000002', color: '#3b82f6', glow: 'rgba(59,130,246,0.45)'  },
  { cls: 'Phantom',   gender: 'female', skin: '#3d1f0a', armor: 'runic',       seed: '0x00000003', color: '#8b5cf6', glow: 'rgba(139,92,246,0.45)'  },
]

// Pre-compute portrait URLs outside the component — pure function, no side effects.
const PORTRAIT_URLS = SHOWCASE.map(s =>
  buildPortraitUrl(s.cls, s.gender, s.skin, s.armor, s.seed)
)

// ── Ember sparks ──────────────────────────────────────────────────────────────
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

// ── Single character slot ─────────────────────────────────────────────────────
function CharacterSlot({
  characterClass,
  portraitUrl,
  color,
  glow,
  size = 'normal',
}: {
  characterClass: string
  portraitUrl:    string
  color:          string
  glow:           string
  size?:          'normal' | 'hero'
}) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="relative h-full flex flex-col items-center justify-end">

      {/* Atmospheric ground glow — visible even while loading */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-none" style={{
        width: '140%', height: '55%',
        background: `radial-gradient(ellipse at 50% 100%, ${color}22 0%, transparent 68%)`,
      }} />

      {/* Loading shimmer — class-tinted, disappears when portrait loads */}
      <AnimatePresence>
        {!loaded && (
          <motion.div
            className="absolute bottom-[8%] rounded-2xl"
            style={{
              width:  size === 'hero' ? '55%' : '42%',
              height: size === 'hero' ? '75%' : '62%',
              background: `linear-gradient(180deg, ${color}06 0%, ${color}14 40%, ${color}06 100%)`,
            }}
            animate={{ opacity: [0.4, 0.9, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
          />
        )}
      </AnimatePresence>

      {/* Portrait — screen-blended so black background vanishes */}
      <motion.img
        src={portraitUrl}
        alt={characterClass}
        onLoad={() => setLoaded(true)}
        draggable={false}
        animate={{ opacity: loaded ? 1 : 0, y: loaded ? 0 : 20 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="relative select-none pointer-events-none"
        style={{
          height:       size === 'hero' ? 'clamp(420px, 78vh, 780px)' : 'clamp(320px, 62vh, 620px)',
          width:        'auto',
          objectFit:    'contain',
          objectPosition: 'bottom',
          mixBlendMode: 'screen',
          filter: `brightness(1.25) contrast(1.08) drop-shadow(0 0 32px ${glow}) drop-shadow(0 0 80px ${glow})`,
        }}
      />

      {/* Class name badge — appears after portrait loads */}
      <AnimatePresence>
        {loaded && (
          <motion.div
            className="absolute bottom-6 flex flex-col items-center gap-0.5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <p
              className="font-display font-black uppercase"
              style={{
                fontSize: size === 'hero' ? '13px' : '10px',
                letterSpacing: '0.28em',
                color,
                textShadow: `0 0 18px ${color}`,
              }}
            >
              {characterClass}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Landing page ──────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { login } = useLogin()
  const embers    = useEmbers()

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#04030c', zIndex: 999 }}>

      {/* ── Atmosphere ─────────────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 55% 70% at 8% 90%, rgba(180,28,0,0.45) 0%, transparent 65%)',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 42% 50% at 50% 88%, rgba(30,70,200,0.28) 0%, transparent 65%)',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 55% 70% at 92% 90%, rgba(90,12,190,0.42) 0%, transparent 65%)',
      }} />

      {/* ── Characters ─────────────────────────────────────────────── */}

      {/* Mobile: Sentinel hero only */}
      <div className="md:hidden absolute inset-0">
        <CharacterSlot
          characterClass={SHOWCASE[1].cls}
          portraitUrl={PORTRAIT_URLS[1]}
          color={SHOWCASE[1].color}
          glow={SHOWCASE[1].glow}
          size="hero"
        />
      </div>

      {/* Desktop: three-column scene */}
      <div className="hidden md:grid absolute inset-0" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        {SHOWCASE.map((s, i) => (
          <CharacterSlot
            key={s.cls}
            characterClass={s.cls}
            portraitUrl={PORTRAIT_URLS[i]}
            color={s.color}
            glow={s.glow}
            size={i === 1 ? 'hero' : 'normal'}
          />
        ))}
      </div>

      {/* ── Overlays ───────────────────────────────────────────────── */}
      {/* Sky fade for title legibility */}
      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{
        height: '38%',
        background: 'linear-gradient(180deg, rgba(4,3,12,0.96) 0%, rgba(4,3,12,0.7) 45%, transparent 100%)',
      }} />
      {/* Ground fade for CTA legibility */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{
        height: '36%',
        background: 'linear-gradient(0deg, rgba(4,3,12,0.97) 0%, rgba(4,3,12,0.72) 50%, transparent 100%)',
      }} />
      {/* Corner vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 90% 88% at 50% 50%, transparent 38%, rgba(4,3,12,0.72) 100%)',
      }} />
      {/* Scanlines */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
      }} />

      {/* ── Weather ────────────────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(168deg, transparent 0px, transparent 5px, rgba(160,200,255,0.04) 5px, rgba(160,200,255,0.04) 6px)',
        backgroundSize: '6px 80px',
        animation: 'rain-fall 0.5s linear infinite',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 45% 75% at 50% 28%, rgba(70,120,255,0.09), transparent 60%)',
        animation: 'lightning-flash 8s ease-in-out infinite',
        animationDelay: '3.2s',
      }} />

      {/* ── Embers ─────────────────────────────────────────────────── */}
      {embers.map(e => (
        <motion.div
          key={e.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left:   `${e.left}%`,
            bottom: '16%',
            width:  e.size,
            height: e.size,
            background: e.color,
            boxShadow: `0 0 ${e.size * 3}px ${e.color}`,
          }}
          animate={{ y: [0, -(560 + e.id * 18)], x: [0, e.drift], opacity: [0, 0.9, 0.55, 0.15, 0] }}
          transition={{ duration: e.duration, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ── Content ────────────────────────────────────────────────── */}
      <div
        className="relative z-10 h-full flex flex-col items-center justify-between px-5"
        style={{ paddingTop: 'clamp(2.5vh, 4.5vh, 6vh)', paddingBottom: 'clamp(3vh, 5vh, 7vh)' }}
      >

        {/* Title */}
        <div className="flex flex-col items-center gap-1.5">
          <motion.div
            className="flex items-center gap-2.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.25 }}
          >
            <div style={{ height: 1, width: 'clamp(36px,7vw,80px)', background: 'linear-gradient(to right, transparent, rgba(234,179,8,0.55))' }} />
            <span className="font-display font-bold uppercase" style={{ fontSize: 'clamp(7px,1.3vw,10px)', letterSpacing: '0.5em', color: 'rgba(234,179,8,0.5)' }}>
              The Arena Awaits
            </span>
            <div style={{ height: 1, width: 'clamp(36px,7vw,80px)', background: 'linear-gradient(to left, transparent, rgba(234,179,8,0.55))' }} />
          </motion.div>

          <div className="font-display font-black leading-none flex select-none" style={{ fontSize: 'clamp(5rem,19vw,12.5rem)', letterSpacing: '0.05em' }}>
            {'VALOR'.split('').map((letter, i) => (
              <motion.span
                key={i}
                style={{
                  display: 'inline-block',
                  background: 'linear-gradient(175deg, #fffbe0 0%, #fde047 18%, #eab308 48%, #b45309 76%, #7c2d12 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  filter: 'drop-shadow(0 0 28px rgba(234,179,8,0.45)) drop-shadow(0 2px 6px rgba(0,0,0,0.9))',
                }}
                initial={{ opacity: 0, y: -18, rotateX: -35 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.5, delay: 0.52 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              >
                {letter}
              </motion.span>
            ))}
          </div>
        </div>

        {/* Spacer — characters live here */}
        <div className="flex-1" />

        {/* CTA */}
        <motion.div
          className="flex flex-col items-center gap-3 w-full"
          style={{ maxWidth: 'clamp(270px,82vw,380px)' }}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.3 }}
        >
          <p className="font-display font-bold uppercase" style={{ fontSize: 'clamp(8px,1.5vw,10px)', letterSpacing: '0.35em', color: 'rgba(100,116,139,0.72)' }}>
            Warriors fight · Legends earn
          </p>

          <div className="flex items-center gap-2">
            {SHOWCASE.map(({ cls, color }, i) => (
              <motion.span
                key={cls}
                className="font-display font-black uppercase rounded-full border"
                style={{ fontSize: '9px', letterSpacing: '0.16em', padding: '4px 10px', color, borderColor: `${color}28`, background: `${color}0e` }}
                initial={{ opacity: 0, scale: 0.84 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.5 + i * 0.09, duration: 0.3 }}
              >
                {cls}
              </motion.span>
            ))}
          </div>

          <motion.button
            onClick={() => login()}
            className="relative overflow-hidden font-display font-black uppercase w-full"
            style={{
              fontSize: 'clamp(12px,2.4vw,15px)',
              letterSpacing: '0.24em',
              color: '#080610',
              padding: 'clamp(15px,3vw,19px) 0',
              background: 'linear-gradient(135deg, #fefce8 0%, #fde047 20%, #eab308 55%, #ca8a04 80%, #92400e 100%)',
              clipPath: 'polygon(14px 0%, 100% 0%, calc(100% - 14px) 100%, 0% 100%)',
              boxShadow: '0 0 36px rgba(234,179,8,0.5), 0 0 72px rgba(234,179,8,0.16), 0 8px 24px rgba(0,0,0,0.95)',
            }}
            whileHover={{ scale: 1.03, boxShadow: '0 0 56px rgba(234,179,8,0.68), 0 0 100px rgba(234,179,8,0.22), 0 8px 32px rgba(0,0,0,0.95)' }}
            whileTap={{ scale: 0.97 }}
          >
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(108deg, transparent 28%, rgba(255,255,255,0.3) 50%, transparent 72%)' }}
              animate={{ x: ['-140%', '220%'] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'linear', repeatDelay: 3.2 }}
            />
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
