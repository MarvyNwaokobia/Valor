'use client'

import { motion } from 'framer-motion'
import { useLogin } from '@privy-io/react-auth'
import { useMemo } from 'react'

// ─── Ember sparks — rise from Berserker fire zone ────────────────────────────
function useEmbers() {
  return useMemo(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left:     3 + ((i * 4.2) % 32),
      delay:    (i * 0.52) % 10,
      duration: 3.8 + ((i * 0.65) % 4.5),
      size:     1 + (i % 4) * 0.55,
      drift:    Math.sin(i * 1.3) * 35,
      color:
        i % 4 === 0 ? 'rgba(251,191,36,0.92)' :
        i % 4 === 1 ? 'rgba(239,68,68,0.82)'  :
        i % 4 === 2 ? 'rgba(251,146,60,0.75)' :
                      'rgba(180,100,20,0.7)',
    }))
  , [])
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { login } = useLogin()
  const embers    = useEmbers()

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#04030c' }}>

      {/* ═══════════════════════════════════════════
          LAYER 1 — SKY GRADIENT
          Deep void at top, slightly warmer toward
          the horizon where the characters stand.
      ═══════════════════════════════════════════ */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(180deg, #04030c 0%, #080612 25%, #0b0710 55%, #06040e 80%, #04030c 100%)',
      }} />

      {/* ═══════════════════════════════════════════
          LAYER 2 — CHARACTERS
          Three individual PNGs composited with
          CSS radial masks. Each character's own
          atmospheric background (fire / lightning
          / void smoke) bleeds into the scene and
          merges with adjacent faction zones.
      ═══════════════════════════════════════════ */}
      <div className="absolute inset-0 pointer-events-none">

        {/* BERSERKER — left third */}
        <div
          className="absolute bottom-0 left-0"
          style={{
            width: '52%',
            height: '82%',
            // Mask: character body fully visible, right edge fades into Sentinel
            maskImage:
              'radial-gradient(ellipse 78% 85% at 52% 62%, ' +
              'black 25%, rgba(0,0,0,0.65) 50%, transparent 76%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 78% 85% at 52% 62%, ' +
              'black 25%, rgba(0,0,0,0.65) 50%, transparent 76%)',
          }}
        >
          <img
            src="/characters/Berserkers.png"
            alt=""
            aria-hidden
            className="w-full h-full object-cover object-center"
            style={{ filter: 'contrast(1.08) saturate(1.06) brightness(0.78)' }}
          />
        </div>

        {/* SENTINEL — center, in front, slightly taller */}
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2"
          style={{
            width: '50%',
            height: '92%',
            zIndex: 2,
            // Symmetric mask — both sides fade into flanking characters
            maskImage:
              'radial-gradient(ellipse 70% 94% at 50% 56%, ' +
              'black 30%, rgba(0,0,0,0.6) 56%, transparent 78%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 70% 94% at 50% 56%, ' +
              'black 30%, rgba(0,0,0,0.6) 56%, transparent 78%)',
          }}
        >
          <img
            src="/characters/Sentinel.png"
            alt=""
            aria-hidden
            className="w-full h-full object-cover object-center"
            style={{ filter: 'contrast(1.1) saturate(0.98) brightness(0.85)' }}
          />
        </div>

        {/* PHANTOM — right third */}
        <div
          className="absolute bottom-0 right-0"
          style={{
            width: '52%',
            height: '82%',
            // Mirror of Berserker mask — left edge fades into Sentinel
            maskImage:
              'radial-gradient(ellipse 78% 85% at 48% 62%, ' +
              'black 25%, rgba(0,0,0,0.65) 50%, transparent 76%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 78% 85% at 48% 62%, ' +
              'black 25%, rgba(0,0,0,0.65) 50%, transparent 76%)',
          }}
        >
          <img
            src="/characters/Phanthom.png"
            alt=""
            aria-hidden
            className="w-full h-full object-cover object-center"
            style={{ filter: 'contrast(1.1) saturate(1.12) brightness(0.75)' }}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          LAYER 3 — FACTION ATMOSPHERE
          Color zones that match each character's
          world. Placed ABOVE character layer so
          they enhance rather than hide.
      ═══════════════════════════════════════════ */}

      {/* Berserker — red fire ground pool, bottom-left */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 44% 42% at 16% 92%, rgba(200,35,0,0.32) 0%, transparent 70%)',
      }} />
      {/* Berserker — mid-height red haze */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 35% 55% at 12% 72%, rgba(160,30,0,0.18) 0%, transparent 65%)',
      }} />

      {/* Sentinel — blue lightning center ground */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 38% 35% at 50% 88%, rgba(40,90,220,0.22) 0%, transparent 70%)',
      }} />

      {/* Phantom — purple void pool, bottom-right */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 44% 42% at 84% 92%, rgba(100,20,200,0.3) 0%, transparent 70%)',
      }} />
      {/* Phantom — mid-height purple haze */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 35% 55% at 88% 72%, rgba(80,15,160,0.18) 0%, transparent 65%)',
      }} />

      {/* ═══════════════════════════════════════════
          LAYER 4 — SCENE STRUCTURE
          Sky / ground fade zones that carve out
          space for UI without painting over art.
      ═══════════════════════════════════════════ */}

      {/* Sky — title lives here */}
      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{
        height: '42%',
        background: 'linear-gradient(180deg, rgba(4,3,12,0.94) 0%, rgba(4,3,12,0.62) 52%, transparent 100%)',
      }} />
      {/* Ground — CTA lives here */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{
        height: '20%',
        background: 'linear-gradient(0deg, rgba(4,3,12,0.98) 0%, rgba(4,3,12,0.72) 55%, transparent 100%)',
      }} />
      {/* Edge vignette — frames composition */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 92% 88% at 50% 50%, transparent 42%, rgba(4,3,12,0.72) 100%)',
      }} />
      {/* Scanlines — game texture layer */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.032) 2px, rgba(0,0,0,0.032) 4px)',
      }} />

      {/* ═══════════════════════════════════════════
          LAYER 5 — WEATHER
          Two rain passes at different densities
          and angles for depth. Pure CSS, no JS.
      ═══════════════════════════════════════════ */}

      {/* Rain pass 1 — dense, near */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `repeating-linear-gradient(
          168deg,
          transparent 0px, transparent 5px,
          rgba(160,195,240,0.045) 5px, rgba(160,195,240,0.045) 6px
        )`,
        backgroundSize: '6px 80px',
        animation: 'rain-fall 0.55s linear infinite',
      }} />
      {/* Rain pass 2 — sparse, far */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `repeating-linear-gradient(
          171deg,
          transparent 0px, transparent 9px,
          rgba(140,180,230,0.028) 9px, rgba(140,180,230,0.028) 10px
        )`,
        backgroundSize: '10px 100px',
        animation: 'rain-fall-2 0.9s linear infinite',
      }} />

      {/* Lightning — center Sentinel zone */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 50% 80% at 50% 30%, rgba(80,130,255,0.09), transparent 65%)',
        animation: 'lightning-flash 7s ease-in-out infinite',
        animationDelay: '2.4s',
      }} />

      {/* ═══════════════════════════════════════════
          LAYER 6 — EMBERS
          Rise from the Berserker fire zone.
      ═══════════════════════════════════════════ */}
      {embers.map(e => (
        <motion.div
          key={e.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left:   `${e.left}%`,
            bottom: '18%',
            width:  e.size,
            height: e.size,
            background: e.color,
            boxShadow: `0 0 4px ${e.color}`,
          }}
          animate={{
            y:       [0, -(520 + e.id * 16)],
            x:       [0, e.drift],
            opacity: [0, 0.88, 0.5, 0.12, 0],
          }}
          transition={{ duration: e.duration, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ═══════════════════════════════════════════
          CONTENT — UI LAYER
          Title → empty character zone → CTA.
          Nothing competes with the characters.
      ═══════════════════════════════════════════ */}
      <div className="relative z-10 h-full flex flex-col items-center justify-between px-4"
           style={{ paddingTop: 'clamp(3vh, 5vh, 6vh)', paddingBottom: 'clamp(3vh, 5vh, 6vh)' }}>

        {/* ── TITLE ──────────────────────────────── */}
        <div className="flex flex-col items-center gap-2">

          {/* Rule + label */}
          <motion.div
            className="flex items-center gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            <motion.div
              className="h-px"
              style={{
                width: 'clamp(40px, 8vw, 88px)',
                background: 'linear-gradient(to right, transparent, rgba(234,179,8,0.52))',
              }}
              initial={{ scaleX: 0, originX: '100%' }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.55, delay: 0.45 }}
            />
            <span
              className="font-display font-bold uppercase"
              style={{ fontSize: 'clamp(7px, 1.4vw, 10px)', letterSpacing: '0.52em', color: 'rgba(234,179,8,0.52)' }}
            >
              The Arena Awaits
            </span>
            <motion.div
              className="h-px"
              style={{
                width: 'clamp(40px, 8vw, 88px)',
                background: 'linear-gradient(to left, transparent, rgba(234,179,8,0.52))',
              }}
              initial={{ scaleX: 0, originX: '0%' }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.55, delay: 0.45 }}
            />
          </motion.div>

          {/* VALOR letterform */}
          <div
            className="font-display font-black leading-none flex select-none"
            style={{ fontSize: 'clamp(4.8rem, 17vw, 11.5rem)', letterSpacing: '0.06em' }}
          >
            {'VALOR'.split('').map((letter, i) => (
              <motion.span
                key={i}
                style={{
                  display: 'inline-block',
                  background:
                    'linear-gradient(175deg, #fff5c0 0%, #fde047 20%, #eab308 50%, #b45309 78%, #7c2d12 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  filter: 'drop-shadow(0 2px 32px rgba(234,179,8,0.38)) drop-shadow(0 0 8px rgba(234,179,8,0.2))',
                }}
                initial={{ opacity: 0, y: -22, rotateX: -38 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.52, delay: 0.55 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              >
                {letter}
              </motion.span>
            ))}
          </div>

          {/* Gold light that falls onto the characters */}
          <motion.div
            className="pointer-events-none"
            style={{
              marginTop: '-1.2rem',
              width: 'clamp(240px, 58vw, 660px)',
              height: 72,
              background:
                'radial-gradient(ellipse 82% 100% at 50% 0%, rgba(234,179,8,0.36) 0%, rgba(180,80,0,0.11) 58%, transparent 100%)',
              filter: 'blur(10px)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.8 }}
          />
        </div>

        {/* ── CHARACTER ZONE — intentionally empty ── */}
        <div className="flex-1" />

        {/* ── CTA ────────────────────────────────── */}
        <motion.div
          className="flex flex-col items-center gap-3 w-full"
          style={{ maxWidth: 'clamp(260px, 80vw, 360px)' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.58, delay: 1.35 }}
        >
          {/* Tagline */}
          <p
            className="font-display font-bold uppercase tracking-widest"
            style={{ fontSize: 'clamp(8px, 1.6vw, 11px)', color: 'rgba(100,116,139,0.75)', letterSpacing: '0.3em' }}
          >
            Warriors fight · Legends earn
          </p>

          {/* Faction badges */}
          <div className="flex items-center gap-2">
            {([
              { name: 'Berserker', color: '#ef4444' },
              { name: 'Sentinel',  color: '#3b82f6' },
              { name: 'Phantom',   color: '#8b5cf6' },
            ] as const).map(({ name, color }, i) => (
              <motion.span
                key={name}
                className="font-display font-black uppercase px-2.5 py-1 rounded-full border"
                style={{
                  fontSize: '9px',
                  letterSpacing: '0.18em',
                  color,
                  borderColor: `${color}28`,
                  background: `${color}0c`,
                }}
                initial={{ opacity: 0, scale: 0.86 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.52 + i * 0.09, duration: 0.35 }}
              >
                {name}
              </motion.span>
            ))}
          </div>

          {/* Enter Valor — main CTA */}
          <motion.button
            onClick={() => login()}
            className="relative overflow-hidden font-display font-black uppercase w-full"
            style={{
              fontSize: 'clamp(12px, 2.2vw, 15px)',
              letterSpacing: '0.22em',
              color: '#0a0a0f',
              padding: 'clamp(14px, 2.8vw, 18px) clamp(32px, 6vw, 56px)',
              background: 'linear-gradient(135deg, #fef9c3 0%, #fde047 22%, #eab308 58%, #b45309 100%)',
              clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)',
              boxShadow: '0 0 38px rgba(234,179,8,0.48), 0 0 80px rgba(234,179,8,0.14), 0 6px 22px rgba(0,0,0,0.92)',
            }}
            whileHover={{
              scale: 1.04,
              boxShadow: '0 0 58px rgba(234,179,8,0.68), 0 0 110px rgba(234,179,8,0.24), 0 6px 28px rgba(0,0,0,0.92)',
            }}
            whileTap={{ scale: 0.97 }}
          >
            {/* Shimmer sweep */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(105deg, transparent 28%, rgba(255,255,255,0.32) 50%, transparent 72%)',
              }}
              animate={{ x: ['-130%', '210%'] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'linear', repeatDelay: 3 }}
            />
            Enter Valor
          </motion.button>

          {/* Legal fine print */}
          <p
            className="text-center uppercase tracking-widest"
            style={{ fontSize: '8px', color: 'rgba(71,85,105,0.65)', letterSpacing: '0.38em' }}
          >
            Powered by GoodDollar · Verified Humans Only
          </p>
        </motion.div>

      </div>
    </div>
  )
}
