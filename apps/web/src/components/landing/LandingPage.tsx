'use client'

import { motion } from 'framer-motion'
import { useLogin } from '@privy-io/react-auth'
import { useMemo } from 'react'

const EMBER_COUNT = 28

function useEmbers() {
  return useMemo(
    () =>
      Array.from({ length: EMBER_COUNT }, (_, i) => ({
        id: i,
        left: 2 + ((i * 3.4) % 96),
        delay: (i * 0.45) % 14,
        duration: 5 + ((i * 0.55) % 7),
        size: 1.5 + (i % 3) * 0.8,
        drift: Math.sin(i * 0.8) * 50,
        color:
          i % 3 === 0
            ? 'rgba(251,191,36,0.85)'
            : i % 3 === 1
              ? 'rgba(251,146,60,0.85)'
              : 'rgba(239,68,68,0.7)',
      })),
    [],
  )
}

export default function LandingPage() {
  const { login } = useLogin()
  const embers = useEmbers()

  return (
    <div
      className="fixed inset-0 z-[999] overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #03030a 0%, #06040e 55%, #0c0508 100%)' }}
    >
      {/* ─── BACKGROUND ATMOSPHERE ─── */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: '70%',
          background:
            'radial-gradient(ellipse 80% 60% at 50% 100%, rgba(180,55,0,0.45) 0%, rgba(100,30,0,0.2) 40%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: '60%',
          background:
            'radial-gradient(ellipse 40% 50% at 50% 90%, rgba(234,179,8,0.1) 0%, transparent 65%)',
        }}
      />
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{ height: '120px', background: 'linear-gradient(180deg, rgba(0,0,0,0.65) 0%, transparent 100%)' }}
      />

      {/* ─── EMBER PARTICLES ─── */}
      {embers.map((e) => (
        <motion.div
          key={e.id}
          className="absolute rounded-full pointer-events-none"
          style={{ left: `${e.left}%`, bottom: -8, width: e.size, height: e.size, background: e.color }}
          animate={{ y: [0, -1400], x: [0, e.drift], opacity: [0, 0.85, 0.7, 0.3, 0] }}
          transition={{ duration: e.duration, delay: e.delay, repeat: Infinity, ease: 'easeOut' }}
        />
      ))}

      {/* ─── CONTENT ─── */}
      <div className="relative z-10 flex flex-col items-center h-full">

        {/* TITLE */}
        <div className="flex flex-col items-center pt-[11vh] gap-3">
          <motion.div
            className="flex items-center gap-5"
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <div className="h-px w-12 md:w-20 bg-gradient-to-r from-transparent to-valor-gold/50" />
            <span className="text-[9px] md:text-[10px] tracking-[0.45em] text-valor-gold/55 uppercase font-semibold">
              The Arena Awaits
            </span>
            <div className="h-px w-12 md:w-20 bg-gradient-to-l from-transparent to-valor-gold/50" />
          </motion.div>

          <motion.h1
            className="font-display font-black text-valor-gold tracking-[0.14em] leading-none"
            style={{
              fontSize: 'clamp(5rem, 16vw, 11rem)',
              textShadow:
                '0 0 40px rgba(234,179,8,0.8), 0 0 90px rgba(234,179,8,0.35), 0 0 160px rgba(234,179,8,0.12)',
            }}
            initial={{ opacity: 0, y: -35, scale: 1.18 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.75, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            VALOR
          </motion.h1>

          <motion.p
            className="text-slate-500 tracking-[0.28em] uppercase text-xs md:text-sm mt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 1.05 }}
          >
            Warriors fight · Legends earn
          </motion.p>
        </div>

        {/* WARRIOR */}
        <div className="flex-1 flex items-end justify-center w-full relative overflow-hidden">
          {/* Backlight glow */}
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-none"
            style={{
              width: 600,
              height: 520,
              background:
                'radial-gradient(ellipse 55% 62% at 50% 88%, rgba(251,146,60,0.5) 0%, rgba(234,179,8,0.2) 28%, transparent 65%)',
            }}
          />
          {/* Ground glow line */}
          <div
            className="absolute pointer-events-none"
            style={{
              bottom: '17%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 340,
              height: 1,
              background:
                'linear-gradient(90deg, transparent, rgba(234,179,8,0.6) 25%, rgba(251,191,36,0.95) 50%, rgba(234,179,8,0.6) 75%, transparent)',
              boxShadow: '0 0 18px rgba(234,179,8,0.5), 0 0 40px rgba(234,179,8,0.2)',
            }}
          />
          <WarriorSilhouette />
        </div>

        {/* CTA */}
        <motion.div
          className="pb-10 md:pb-14 flex flex-col items-center gap-3"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.35 }}
        >
          <motion.button
            onClick={() => login()}
            whileHover={{ scale: 1.06, filter: 'brightness(1.15)' }}
            whileTap={{ scale: 0.95 }}
            className="px-12 py-4 font-display font-bold text-black uppercase tracking-[0.18em] text-sm md:text-base"
            style={{
              background: 'linear-gradient(135deg, #fde047 0%, #eab308 50%, #b45309 100%)',
              clipPath: 'polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%)',
              boxShadow: '0 0 35px rgba(234,179,8,0.45), 0 0 70px rgba(234,179,8,0.15)',
            }}
          >
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

function WarriorSilhouette() {
  return (
    <motion.svg
      viewBox="-25 -45 300 555"
      className="w-auto relative z-10"
      style={{
        height: 'clamp(290px, 46vh, 470px)',
        filter:
          'drop-shadow(0 0 22px rgba(251,146,60,0.55)) drop-shadow(0 0 8px rgba(234,179,8,0.45))',
      }}
      initial={{ opacity: 0, y: 25 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.1, delay: 0.65, ease: [0.16, 1, 0.3, 1] }}
    >
      <g fill="#05050c">
        {/* ── CAPE (behind body) ── */}
        <path d="M 118 100 Q 168 125, 215 168 Q 238 215, 230 295 Q 220 368, 196 432 L 176 427 Q 198 366, 204 288 Q 210 213, 182 170 Q 156 135, 126 116 Z" />

        {/* ── BOOTS ── */}
        <path d="M 56 444 C 48 455, 44 468, 49 480 L 98 480 L 98 466 L 64 462 Z" />
        <path d="M 144 444 C 152 455, 156 468, 151 480 L 104 480 L 104 466 L 138 462 Z" />

        {/* ── LEGS ── */}
        <path d="M 70 252 L 63 342 L 58 400 L 56 444 L 90 444 L 92 398 L 96 338 L 100 252 Z" />
        <path d="M 108 252 L 110 338 L 114 398 L 112 444 L 146 444 L 144 400 L 140 342 L 132 252 Z" />

        {/* ── TORSO ── */}
        <path d="M 72 114 L 63 168 L 61 212 L 66 252 L 136 252 L 141 212 L 139 168 L 130 114 Z" />

        {/* ── PAULDRONS ── */}
        <path d="M 38 104 Q 52 94, 70 106 Q 76 118, 65 124 Q 50 130, 36 118 Z" />
        <path d="M 162 104 Q 150 94, 132 106 Q 126 118, 138 124 Q 152 130, 166 118 Z" />

        {/* ── NECK ── */}
        <rect x="90" y="90" width="22" height="28" rx="4" />

        {/* ── HELMET ── */}
        <path d="M 76 90 L 74 65 L 77 42 L 87 26 L 101 20 L 120 20 L 132 26 L 136 42 L 138 65 L 136 90 Z" />
        {/* Helm top crest */}
        <path d="M 92 22 L 90 6 L 96 2 L 107 0 L 122 2 L 126 6 L 124 22 Z" />
        {/* Visor slot */}
        <rect x="84" y="60" width="44" height="20" rx="2.5" fill="#0c0c1e" />
        <rect x="86" y="62" width="40" height="9" rx="1.5" fill="#080816" />
        {/* Chin guard */}
        <path d="M 80 88 L 77 97 L 85 102 L 117 102 L 125 97 L 122 88 Z" />

        {/* ── LEFT ARM + SHIELD ── */}
        <path d="M 62 118 L 45 138 L 32 162 L 28 188 L 40 193 L 52 170 L 64 145 L 72 122 Z" />
        {/* Kite shield */}
        <path d="M 2 172 C -6 186, -12 220, -8 248 C -4 268, 10 284, 26 288 C 40 292, 50 280, 52 262 C 54 244, 50 218, 44 196 C 38 174, 24 162, 10 165 Z" />
        {/* Shield boss */}
        <circle cx="21" cy="228" r="9" fill="#08081c" />
        <circle cx="21" cy="228" r="5" fill="#05050e" />
        {/* Shield rim glow */}
        <path
          d="M 2 172 C -6 186, -12 220, -8 248 C -4 268, 10 284, 26 288 C 40 292, 50 280, 52 262 C 54 244, 50 218, 44 196 C 38 174, 24 162, 10 165 Z"
          fill="none"
          stroke="rgba(234,179,8,0.18)"
          strokeWidth="1.5"
        />

        {/* ── RIGHT ARM RAISED ── */}
        <path d="M 150 118 L 164 94 L 175 68 L 178 44 L 170 39 L 166 64 L 154 90 L 142 114 Z" />

        {/* ── SWORD ── */}
        {/* Blade */}
        <path d="M 170 38 L 175 -42 L 181 -40 L 177 40 Z" transform="rotate(6, 176, -2)" />
        {/* Crossguard */}
        <rect x="158" y="31" width="38" height="9" rx="2.5" transform="rotate(6, 177, 35)" />
        {/* Grip */}
        <rect x="170" y="40" width="10" height="26" rx="2.5" transform="rotate(6, 175, 53)" />
        {/* Pommel */}
        <circle cx="176" cy="70" r="8" />
        <circle cx="176" cy="70" r="4.5" fill="#08081a" />
      </g>
    </motion.svg>
  )
}
