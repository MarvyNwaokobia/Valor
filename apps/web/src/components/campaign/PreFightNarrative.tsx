'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Chapter, DialogueLine } from '@/lib/campaign'
import { CLASS_DEFINITIONS } from '@/lib/classes'

interface Props {
  chapter: Chapter
  onReady: () => void
}

export default function PreFightNarrative({ chapter, onReady }: Props) {
  const [lineIndex, setLineIndex] = useState(-1)
  const [showBossCard, setShowBossCard] = useState(false)
  const [charIndex, setCharIndex] = useState(0)
  const [canSkip, setCanSkip] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lines = chapter.preFightDialogue
  const currentLine: DialogueLine | null = lineIndex >= 0 && lineIndex < lines.length ? lines[lineIndex] : null
  const currentText = currentLine?.text ?? ''
  const displayText = currentText.slice(0, charIndex)
  const isTyping = charIndex < currentText.length

  const bossDef = CLASS_DEFINITIONS[chapter.boss.characterClass]
  const bossColor = chapter.boss.accentColor

  // Start after brief delay
  useEffect(() => {
    const t = setTimeout(() => {
      setLineIndex(0)
      setCanSkip(true)
    }, 800)
    return () => clearTimeout(t)
  }, [])

  // Typewriter effect
  useEffect(() => {
    if (!currentLine || charIndex >= currentText.length) return
    const speed = currentLine.speaker === 'narrator' ? 30 : 25
    timerRef.current = setTimeout(() => setCharIndex(i => i + 1), speed)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [charIndex, currentLine, currentText])

  // Reset char index on new line
  useEffect(() => {
    setCharIndex(0)
  }, [lineIndex])

  function advance() {
    if (!canSkip) return

    if (isTyping) {
      setCharIndex(currentText.length)
      return
    }

    if (lineIndex < lines.length - 1) {
      setLineIndex(i => i + 1)
    } else {
      setShowBossCard(true)
      setTimeout(onReady, 2500)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end cursor-pointer select-none"
      style={{ background: '#04030c' }}
      onClick={advance}
      onKeyDown={(e) => { if (e.code === 'Space' || e.code === 'Enter') advance() }}
      tabIndex={0}
    >
      {/* Atmospheric background */}
      <div className="absolute inset-0 pointer-events-none">
        <div style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 40%, ${bossColor}08, transparent),
                       radial-gradient(ellipse 120% 80% at 50% 110%, rgba(30,10,50,0.6), transparent)`,
        }} className="absolute inset-0" />
      </div>

      {/* Chapter number + title — top */}
      <motion.div
        className="absolute top-0 inset-x-0 z-10 pt-12 px-8 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
      >
        <p className="text-[10px] font-black uppercase tracking-[0.5em]"
          style={{ color: `${bossColor}80` }}>
          Chapter {chapter.number}
        </p>
        <h1 className="font-display font-black text-white mt-1"
          style={{ fontSize: 'clamp(1.5rem, 5vw, 2.5rem)', letterSpacing: '0.06em' }}>
          {chapter.title}
        </h1>
        <p className="text-slate-500 text-sm mt-1 italic">{chapter.subtitle}</p>
      </motion.div>

      {/* Boss intro card — appears after dialogue */}
      <AnimatePresence>
        {showBossCard && (
          <motion.div
            className="absolute inset-0 z-20 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              className="text-center"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 150, damping: 12 }}
            >
              <p className="text-[9px] font-black uppercase tracking-[0.4em]"
                style={{ color: `${bossColor}70` }}>
                {bossDef.name}
              </p>
              <h2 className="font-display font-black mt-2"
                style={{
                  fontSize: 'clamp(2.5rem, 10vw, 5rem)',
                  color: bossColor,
                  textShadow: `0 0 60px ${bossColor}60, 0 0 120px ${bossColor}30`,
                  letterSpacing: '0.05em',
                }}>
                {chapter.boss.name}
              </h2>
              <p className="font-display font-black text-white/50 mt-1"
                style={{ fontSize: 'clamp(0.9rem, 3vw, 1.4rem)', letterSpacing: '0.15em' }}>
                {chapter.boss.title}
              </p>

              <motion.div
                className="mt-6 flex items-center justify-center gap-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0.6, 1] }}
                transition={{ delay: 0.8, duration: 0.6 }}
              >
                <div className="w-8 h-[1px]" style={{ background: `${bossColor}40` }} />
                <span className="text-[8px] font-black uppercase tracking-[0.3em]"
                  style={{ color: bossColor }}>
                  FIGHT
                </span>
                <div className="w-8 h-[1px]" style={{ background: `${bossColor}40` }} />
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dialogue box — bottom */}
      <AnimatePresence>
        {currentLine && !showBossCard && (
          <motion.div
            className="relative z-10 px-6 pb-10"
            style={{ paddingBottom: 'max(40px, env(safe-area-inset-bottom, 40px))' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Speaker label */}
            {currentLine.speaker === 'boss' && (
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded-full border flex items-center justify-center"
                  style={{ borderColor: `${bossColor}60`, background: `${bossColor}20` }}>
                  <span style={{ fontSize: 8, color: bossColor }}>⚔</span>
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em]"
                  style={{ color: bossColor }}>
                  {chapter.boss.name}
                </span>
              </div>
            )}

            {/* Dialogue text */}
            <div className="rounded-xl p-5"
              style={{
                background: currentLine.speaker === 'narrator'
                  ? 'rgba(4,3,12,0.85)'
                  : `rgba(4,3,12,0.9)`,
                border: `1px solid ${currentLine.speaker === 'narrator' ? 'rgba(42,42,58,0.5)' : `${bossColor}30`}`,
              }}>
              <p className="leading-relaxed"
                style={{
                  fontSize: 'clamp(0.9rem, 3vw, 1.1rem)',
                  color: currentLine.speaker === 'narrator' ? 'rgba(148,163,184,0.9)' : '#e2e8f0',
                  fontStyle: currentLine.speaker === 'narrator' ? 'italic' : 'normal',
                  fontWeight: currentLine.speaker === 'boss' ? 700 : 400,
                }}>
                {displayText}
                {isTyping && <span className="animate-pulse">|</span>}
              </p>
            </div>

            {/* Skip hint */}
            <p className="text-center mt-3 text-[9px] text-slate-600 uppercase tracking-widest">
              {isTyping ? 'Tap to skip' : 'Tap to continue'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
