'use client'

import { motion } from 'framer-motion'
import { useLogin } from '@privy-io/react-auth'
import { useMemo } from 'react'

// ─── Ember sparks — scoped to Berserker fire zone (left 30%) ─────────────────
function useEmbers() {
  return useMemo(() =>
    Array.from({ length: 22 }, (_, i) => ({
      id: i,
      left:     2 + ((i * 3.8) % 28),
      delay:    (i * 0.48) % 11,
      duration: 3.5 + ((i * 0.7) % 5),
      size:     0.9 + (i % 4) * 0.55,
      drift:    Math.sin(i * 1.2) * 32,
      color:
        i % 4 === 0 ? 'rgba(255,200,50,0.95)'  :
        i % 4 === 1 ? 'rgba(239,68,68,0.85)'   :
        i % 4 === 2 ? 'rgba(255,140,30,0.78)'  :
                      'rgba(180,60,0,0.7)',
    }))
  , [])
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { login } = useLogin()
  const embers    = useEmbers()

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: '#04030c', zIndex: 999 }}
    >

      {/* ═══════════════════════════════════════════════════════════
          ATMOSPHERE — faction color zones rendered FIRST so the
          screen-blended characters absorb these colors.
          Berserker fire (left) · Sentinel storm (center) · Phantom void (right)
      ═══════════════════════════════════════════════════════════ */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 55% 70% at 8% 90%, rgba(180,28,0,0.55) 0%, transparent 65%)',
      }}/>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 40% 60% at 8% 68%, rgba(140,22,0,0.28) 0%, transparent 60%)',
      }}/>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 42% 50% at 50% 88%, rgba(30,70,200,0.32) 0%, transparent 65%)',
      }}/>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 55% 70% at 92% 90%, rgba(90,12,190,0.5) 0%, transparent 65%)',
      }}/>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 40% 60% at 92% 68%, rgba(70,8,150,0.28) 0%, transparent 60%)',
      }}/>

      {/* ═══════════════════════════════════════════════════════════
          CHARACTERS — mix-blend-mode: screen
          Screen blend against near-black (#04030c) base means
          dark background pixels in each PNG become transparent.
          No seams. No rectangles. Only light survives.

          Each image is also brightness-boosted so dark character
          details remain visible through the screen blend.
      ═══════════════════════════════════════════════════════════ */}
      <div className="absolute inset-0 pointer-events-none">

        {/* ── BERSERKER — left ──────────────────────────────────── */}
        {/* object-position crops to the male character (left half of the duo image) */}
        <div
          className="absolute bottom-0 left-0"
          style={{ width: '52%', height: '88%' }}
        >
          <img
            src="/characters/Berserkers.png"
            alt=""
            aria-hidden
            className="w-full h-full"
            style={{
              objectFit: 'cover',
              objectPosition: '20% 12%',
              mixBlendMode: 'screen',
              filter: 'brightness(1.3) contrast(1.12) saturate(1.08)',
              maskImage:
                'linear-gradient(to bottom, transparent 0%, black 8%, black 82%, transparent 100%), ' +
                'linear-gradient(to right, black 0%, black 72%, transparent 100%)',
              maskComposite: 'intersect',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, black 8%, black 82%, transparent 100%), ' +
                'linear-gradient(to right, black 0%, black 72%, transparent 100%)',
              WebkitMaskComposite: 'source-in',
            }}
          />
        </div>

        {/* ── SENTINEL — center, dominant ───────────────────────── */}
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2"
          style={{ width: '56%', height: '100%', zIndex: 2 }}
        >
          <img
            src="/characters/Sentinel.png"
            alt=""
            aria-hidden
            className="w-full h-full"
            style={{
              objectFit: 'cover',
              objectPosition: 'center 8%',
              mixBlendMode: 'screen',
              filter: 'brightness(1.38) contrast(1.1) saturate(1.0)',
              maskImage:
                'linear-gradient(to bottom, transparent 0%, black 6%, black 84%, transparent 100%), ' +
                'linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)',
              maskComposite: 'intersect',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, black 6%, black 84%, transparent 100%), ' +
                'linear-gradient(to right, transparent 0%, black 14%, black 86%, transparent 100%)',
              WebkitMaskComposite: 'source-in',
            }}
          />
        </div>

        {/* ── PHANTOM — right ───────────────────────────────────── */}
        {/* Phantom is dark tactical gear — needs most brightness boost */}
        <div
          className="absolute bottom-0 right-0"
          style={{ width: '52%', height: '88%' }}
        >
          <img
            src="/characters/Phanthom.png"
            alt=""
            aria-hidden
            className="w-full h-full"
            style={{
              objectFit: 'cover',
              objectPosition: '80% 12%',
              mixBlendMode: 'screen',
              filter: 'brightness(1.55) contrast(1.18) saturate(1.15)',
              maskImage:
                'linear-gradient(to bottom, transparent 0%, black 8%, black 82%, transparent 100%), ' +
                'linear-gradient(to left, black 0%, black 72%, transparent 100%)',
              maskComposite: 'intersect',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, black 8%, black 82%, transparent 100%), ' +
                'linear-gradient(to left, black 0%, black 72%, transparent 100%)',
              WebkitMaskComposite: 'source-in',
            }}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          STRUCTURAL OVERLAYS — carve dark zones for UI.
          These go ON TOP of characters without hiding them.
      ═══════════════════════════════════════════════════════════ */}

      {/* Sky — title zone */}
      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{
        height: '38%',
        background: 'linear-gradient(180deg, rgba(4,3,12,0.96) 0%, rgba(4,3,12,0.68) 50%, transparent 100%)',
      }}/>
      {/* Ground — CTA zone */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none" style={{
        height: '22%',
        background: 'linear-gradient(0deg, rgba(4,3,12,0.99) 0%, rgba(4,3,12,0.75) 45%, transparent 100%)',
      }}/>
      {/* Corner vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 94% 90% at 50% 50%, transparent 38%, rgba(4,3,12,0.78) 100%)',
      }}/>
      {/* Scanlines */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
      }}/>

      {/* ═══════════════════════════════════════════════════════════
          WEATHER — pure CSS, zero JS, mobile-friendly
      ═══════════════════════════════════════════════════════════ */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(168deg, transparent 0px, transparent 5px, rgba(160,200,255,0.04) 5px, rgba(160,200,255,0.04) 6px)',
        backgroundSize: '6px 80px',
        animation: 'rain-fall 0.5s linear infinite',
      }}/>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(172deg, transparent 0px, transparent 9px, rgba(140,180,230,0.025) 9px, rgba(140,180,230,0.025) 10px)',
        backgroundSize: '11px 110px',
        animation: 'rain-fall-2 0.85s linear infinite',
      }}/>
      {/* Lightning center pulse */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 45% 75% at 50% 28%, rgba(70,120,255,0.1), transparent 60%)',
        animation: 'lightning-flash 8s ease-in-out infinite',
        animationDelay: '3.2s',
      }}/>

      {/* ═══════════════════════════════════════════════════════════
          EMBERS — rise from Berserker fire zone, left third
      ═══════════════════════════════════════════════════════════ */}
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
          animate={{
            y:       [0, -(560 + e.id * 18)],
            x:       [0, e.drift],
            opacity: [0, 0.9, 0.55, 0.15, 0],
          }}
          transition={{ duration: e.duration, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ═══════════════════════════════════════════════════════════
          CONTENT — title zone (top) · empty · CTA (bottom)
      ═══════════════════════════════════════════════════════════ */}
      <div
        className="relative z-10 h-full flex flex-col items-center justify-between px-5"
        style={{ paddingTop: 'clamp(2.5vh, 4.5vh, 6vh)', paddingBottom: 'clamp(3vh, 5vh, 7vh)' }}
      >

        {/* ── TITLE ──────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-1.5">

          {/* Eyebrow rule */}
          <motion.div
            className="flex items-center gap-2.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.25 }}
          >
            <motion.div
              style={{
                height: 1,
                width: 'clamp(36px, 7vw, 80px)',
                background: 'linear-gradient(to right, transparent, rgba(234,179,8,0.55))',
              }}
              initial={{ scaleX: 0, originX: '100%' }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            />
            <span
              className="font-display font-bold uppercase"
              style={{
                fontSize: 'clamp(7px, 1.3vw, 10px)',
                letterSpacing: '0.5em',
                color: 'rgba(234,179,8,0.5)',
              }}
            >
              The Arena Awaits
            </span>
            <motion.div
              style={{
                height: 1,
                width: 'clamp(36px, 7vw, 80px)',
                background: 'linear-gradient(to left, transparent, rgba(234,179,8,0.55))',
              }}
              initial={{ scaleX: 0, originX: '0%' }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            />
          </motion.div>

          {/* VALOR wordmark */}
          <div
            className="font-display font-black leading-none flex select-none"
            style={{ fontSize: 'clamp(5rem, 19vw, 12.5rem)', letterSpacing: '0.05em' }}
          >
            {'VALOR'.split('').map((letter, i) => (
              <motion.span
                key={i}
                style={{
                  display: 'inline-block',
                  background:
                    'linear-gradient(175deg, #fffbe0 0%, #fde047 18%, #eab308 48%, #b45309 76%, #7c2d12 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  filter:
                    'drop-shadow(0 0 28px rgba(234,179,8,0.45)) drop-shadow(0 2px 6px rgba(0,0,0,0.9))',
                }}
                initial={{ opacity: 0, y: -18, rotateX: -35 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.5, delay: 0.52 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              >
                {letter}
              </motion.span>
            ))}
          </div>

          {/* Gold firelight falls onto characters below */}
          <motion.div
            style={{
              marginTop: '-1rem',
              width: 'clamp(220px, 55vw, 620px)',
              height: 68,
              background:
                'radial-gradient(ellipse 85% 100% at 50% 0%, rgba(234,179,8,0.4) 0%, rgba(180,80,0,0.12) 55%, transparent 100%)',
              filter: 'blur(10px)',
              pointerEvents: 'none',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.9 }}
          />
        </div>

        {/* ── CHARACTER ZONE — scene lives here, no UI ────────────── */}
        <div className="flex-1" />

        {/* ── CTA ─────────────────────────────────────────────────── */}
        <motion.div
          className="flex flex-col items-center gap-3 w-full"
          style={{ maxWidth: 'clamp(270px, 82vw, 380px)' }}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.3 }}
        >
          <p
            className="font-display font-bold uppercase"
            style={{
              fontSize: 'clamp(8px, 1.5vw, 10px)',
              letterSpacing: '0.35em',
              color: 'rgba(100,116,139,0.72)',
            }}
          >
            Warriors fight · Legends earn
          </p>

          {/* Faction class pills */}
          <div className="flex items-center gap-2">
            {([
              { name: 'Berserker', color: '#ef4444' },
              { name: 'Sentinel',  color: '#3b82f6' },
              { name: 'Phantom',   color: '#8b5cf6' },
            ] as const).map(({ name, color }, i) => (
              <motion.span
                key={name}
                className="font-display font-black uppercase rounded-full border"
                style={{
                  fontSize: '9px',
                  letterSpacing: '0.16em',
                  padding: '4px 10px',
                  color,
                  borderColor: `${color}28`,
                  background: `${color}0e`,
                }}
                initial={{ opacity: 0, scale: 0.84 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.5 + i * 0.09, duration: 0.3 }}
              >
                {name}
              </motion.span>
            ))}
          </div>

          {/* Enter Valor CTA */}
          <motion.button
            onClick={() => login()}
            className="relative overflow-hidden font-display font-black uppercase w-full"
            style={{
              fontSize: 'clamp(12px, 2.4vw, 15px)',
              letterSpacing: '0.24em',
              color: '#080610',
              padding: 'clamp(15px, 3vw, 19px) 0',
              background:
                'linear-gradient(135deg, #fefce8 0%, #fde047 20%, #eab308 55%, #ca8a04 80%, #92400e 100%)',
              clipPath: 'polygon(14px 0%, 100% 0%, calc(100% - 14px) 100%, 0% 100%)',
              boxShadow:
                '0 0 36px rgba(234,179,8,0.5), 0 0 72px rgba(234,179,8,0.16), 0 8px 24px rgba(0,0,0,0.95)',
            }}
            whileHover={{
              scale: 1.03,
              boxShadow:
                '0 0 56px rgba(234,179,8,0.68), 0 0 100px rgba(234,179,8,0.22), 0 8px 32px rgba(0,0,0,0.95)',
            }}
            whileTap={{ scale: 0.97 }}
          >
            {/* Shimmer */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(108deg, transparent 28%, rgba(255,255,255,0.3) 50%, transparent 72%)',
              }}
              animate={{ x: ['-140%', '220%'] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'linear', repeatDelay: 3.2 }}
            />
            Enter Valor
          </motion.button>

          <p
            className="text-center uppercase"
            style={{
              fontSize: '8px',
              letterSpacing: '0.36em',
              color: 'rgba(71,85,105,0.6)',
            }}
          >
            Powered by GoodDollar · Verified Humans Only
          </p>
        </motion.div>

      </div>
    </div>
  )
}
