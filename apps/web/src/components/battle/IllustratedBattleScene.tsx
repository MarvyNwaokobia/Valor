'use client'

import { motion } from 'framer-motion'
import { CLASS_DEFINITIONS, ILLUSTRATED_CLASS_ART } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'

interface Props {
  playerClass: CharacterClass
  playerAnim: string
  playerAccentColor: string
  botClass: CharacterClass
  botAnim: string
  botAccentColor: string
}

function fighterMotion(side: 'player' | 'bot', anim: string) {
  const dir = side === 'player' ? 1 : -1
  if (anim === 'attack') {
    return {
      x: [0, dir * 42, dir * 18, 0],
      y: [0, -3, 0, 0],
      rotate: [0, dir * -3, dir * 2, 0],
      scale: [1, 1.035, 1.02, 1],
    }
  }
  if (anim === 'hit') {
    return {
      x: [0, dir * -28, dir * 12, 0],
      y: [0, 8, -2, 0],
      rotate: [0, dir * 4, dir * -2, 0],
      scale: [1, 0.98, 1.01, 1],
    }
  }
  if (anim === 'death') {
    return {
      x: dir * -34,
      y: 34,
      rotate: dir * 9,
      scale: 0.92,
      opacity: 0.55,
    }
  }
  return {
    x: [0, dir * 3, 0],
    y: [0, -6, 0],
    rotate: [0, dir * 0.7, 0],
    scale: [1, 1.01, 1],
    opacity: 1,
  }
}

function IllustratedFighter({
  side,
  characterClass,
  accentColor,
  anim,
}: {
  side: 'player' | 'bot'
  characterClass: CharacterClass
  accentColor: string
  anim: string
}) {
  const art = ILLUSTRATED_CLASS_ART[characterClass]
  const isBot = side === 'bot'
  const baseLeft = isBot ? '58%' : '7%'
  const def = CLASS_DEFINITIONS[characterClass]

  return (
    <motion.div
      className="absolute bottom-[5%] z-20 pointer-events-none"
      style={{
        left: baseLeft,
        width: 'clamp(220px, 34vw, 420px)',
        height: 'clamp(300px, 66vh, 620px)',
        transformOrigin: '50% 82%',
      }}
      animate={fighterMotion(side, anim)}
      transition={anim === 'idle'
        ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }
        : { duration: anim === 'attack' ? 0.42 : 0.34, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: isBot ? 'scaleX(-1)' : undefined,
          filter: `drop-shadow(0 0 24px ${accentColor}88) drop-shadow(0 26px 36px rgba(0,0,0,0.95))`,
        }}
      >
        <img
          src={art}
          alt=""
          aria-hidden
          draggable={false}
          className="h-full w-full object-contain object-bottom select-none"
          style={{
            objectPosition: '50% 100%',
            mixBlendMode: 'screen',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 55% 38% at 50% 56%, ${accentColor}1c, transparent 72%)`,
            mixBlendMode: 'screen',
          }}
        />
      </div>
      <div
        className="absolute left-1/2 bottom-[3%] -translate-x-1/2 h-4 w-3/5 rounded-full blur-md"
        style={{ background: `${accentColor}55` }}
      />
      <div className={`absolute ${isBot ? 'right-[16%]' : 'left-[16%]'} bottom-[18%]`}>
        <span
          className="font-display font-black uppercase tracking-[0.22em]"
          style={{
            color: accentColor,
            fontSize: 9,
            textShadow: `0 0 12px ${accentColor}`,
          }}
        >
          {def.name}
        </span>
      </div>
    </motion.div>
  )
}

export default function IllustratedBattleScene({
  playerClass,
  playerAnim,
  playerAccentColor,
  botClass,
  botAnim,
  botAccentColor,
}: Props) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#080312' }}>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 15%, rgba(213,190,255,0.28) 0%, rgba(105,70,180,0.12) 12%, transparent 24%), linear-gradient(180deg, #171032 0%, #090413 42%, #03020a 100%)',
        }}
      />

      <motion.div
        className="absolute left-1/2 top-[10%] -translate-x-1/2 rounded-full"
        style={{
          width: 'clamp(86px, 13vw, 148px)',
          aspectRatio: '1',
          background: 'radial-gradient(circle, #f1eaff 0%, #b29cff 46%, rgba(101,69,168,0.28) 68%, transparent 72%)',
          boxShadow: '0 0 70px rgba(188,160,255,0.75), 0 0 150px rgba(139,92,246,0.35)',
        }}
        animate={{ opacity: [0.82, 1, 0.82], scale: [1, 1.035, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="absolute inset-x-0 top-0 h-[46%] opacity-75" style={{
        background:
          'radial-gradient(ellipse at 22% 55%, rgba(255,255,255,0.08), transparent 24%), radial-gradient(ellipse at 78% 45%, rgba(255,255,255,0.07), transparent 26%), linear-gradient(180deg, rgba(21,16,43,0.9), transparent)',
        filter: 'blur(0.2px)',
      }} />

      <div className="absolute left-[45%] top-[17%] h-[46%] w-[18%] opacity-80">
        <div className="absolute left-[46%] top-0 h-full w-[12%] rounded-t-full" style={{ background: 'linear-gradient(180deg, #25183f, #0c0616)' }} />
        {[-44, -25, 28, 48].map((rotate, index) => (
          <div
            key={index}
            className="absolute left-1/2 top-[18%] h-[48%] w-[7%] origin-bottom rounded-t-full"
            style={{
              background: 'linear-gradient(180deg, #33214f, #0a0512)',
              transform: `translateX(-50%) rotate(${rotate}deg)`,
            }}
          />
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 h-[46%]" style={{
        background: 'linear-gradient(180deg, transparent 0%, rgba(33,13,54,0.74) 32%, #04020a 100%)',
      }} />

      <motion.div
        className="absolute left-1/2 bottom-[8%] -translate-x-1/2 rounded-full border"
        style={{
          width: 'min(74vw, 760px)',
          height: 'min(19vw, 170px)',
          borderColor: 'rgba(216,180,254,0.55)',
          boxShadow: '0 0 32px rgba(168,85,247,0.55), inset 0 0 36px rgba(168,85,247,0.22)',
          background: 'radial-gradient(ellipse, rgba(168,85,247,0.18), rgba(59,7,100,0.06) 54%, transparent 72%)',
        }}
        animate={{ opacity: [0.6, 1, 0.6], scaleX: [1, 1.025, 1] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        {Array.from({ length: 18 }).map((_, index) => (
          <span
            key={index}
            className="absolute font-display font-black"
            style={{
              left: `${50 + Math.cos((index / 18) * Math.PI * 2) * 47}%`,
              top: `${50 + Math.sin((index / 18) * Math.PI * 2) * 41}%`,
              color: 'rgba(233,213,255,0.72)',
              fontSize: 10,
              transform: `translate(-50%, -50%) rotate(${index * 20}deg)`,
              textShadow: '0 0 10px rgba(216,180,254,0.8)',
            }}
          >
            ᚱ
          </span>
        ))}
      </motion.div>

      <div className="absolute inset-x-0 bottom-0 h-[22%]" style={{
        background: 'linear-gradient(180deg, rgba(8,3,18,0), rgba(2,1,5,0.96))',
      }} />

      <IllustratedFighter side="player" characterClass={playerClass} accentColor={playerAccentColor} anim={playerAnim} />
      <IllustratedFighter side="bot" characterClass={botClass} accentColor={botAccentColor} anim={botAnim} />

      <div className="absolute inset-0 pointer-events-none" style={{
        background: `linear-gradient(90deg, ${playerAccentColor}12 0%, transparent 34%, transparent 66%, ${botAccentColor}12 100%)`,
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        boxShadow: 'inset 0 0 110px rgba(0,0,0,0.95)',
      }} />
    </div>
  )
}
