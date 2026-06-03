'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { supabase } from '@/lib/supabase'
import { CHARACTER_CLASSES, CLASS_DEFINITIONS, statVarianceFromWallet } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'
import type { PlayStyle } from '@/types'
import CharacterPreview from '@/components/warrior/CharacterPreview'
import ClassSilhouette from '@/components/warrior/ClassSilhouette'

// ─── Customization options ────────────────────────────────────────────────────

const SKIN_TONES = [
  '#fde8d5', '#f5c9a0', '#d4935a', '#a0612a', '#7b4012', '#3d1f0a',
]

const HAIR_COLORS = [
  '#0a0805', '#3d2210', '#6b2a12', '#c8901a', '#c8c0a8', '#e8e4f0',
]

const HAIR_STYLE_LABELS = ['Crop', 'Spiky', 'Long', 'Topknot', 'Bald']

const PREFIXES = ['Iron', 'Dark', 'Storm', 'Ash', 'Void', 'Flame', 'Shadow', 'Silver', 'Crimson', 'Frost', 'Thunder', 'Ember', 'Blood', 'Death', 'War']
const SUFFIXES = ['Blade', 'Fist', 'Heart', 'Walker', 'Strike', 'Guard', 'Born', 'Wolf', 'Hawk', 'Bane', 'Forge', 'Rift', 'Claw', 'Rage', 'Fire']

function deterministicName(wallet: string): string {
  const seed = wallet.replace('0x', '').slice(0, 8)
  const hash = seed.split('').reduce((acc, ch) => ((acc * 31 + ch.charCodeAt(0)) >>> 0), 7)
  const prefix = PREFIXES[hash % PREFIXES.length] ?? 'Iron'
  const suffix = SUFFIXES[(hash >> 4) % SUFFIXES.length] ?? 'Blade'
  return `${prefix}${suffix}`
}

type Tab = 'class' | 'look' | 'details'

const PLAY_STYLE_LABELS: Record<PlayStyle, string> = {
  Wanderer: 'Idle missions & passive XP',
  Fighter:  'Max XP through battles',
  Champion: 'Battle and idle — both',
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  walletAddress: `0x${string}`
  onCreated: () => void
}

export default function CharacterCreation({ walletAddress, onCreated }: Props) {
  const setPlayer = usePlayerStore((s) => s.setPlayer)

  const characterName = useMemo(() => deterministicName(walletAddress), [walletAddress])
  const variance = useMemo(() => statVarianceFromWallet(walletAddress), [walletAddress])

  const [selectedClass, setSelectedClass] = useState<CharacterClass>('Berserker')
  const [skinTone, setSkinTone] = useState(SKIN_TONES[1])
  const [hairStyle, setHairStyle] = useState(0)
  const [hairColor, setHairColor] = useState(HAIR_COLORS[0])
  const [playStyle, setPlayStyle] = useState<PlayStyle>('Fighter')
  const [tab, setTab] = useState<Tab>('class')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const def = CLASS_DEFINITIONS[selectedClass]
  const stats = {
    attack:  def.stats.attack  + variance,
    defense: def.stats.defense + variance,
    speed:   def.stats.speed   + variance,
  }

  async function handleCreate() {
    setPending(true)
    setError(null)

    const now = new Date().toISOString()
    const newPlayer = {
      wallet_address:          walletAddress,
      play_style:              playStyle,
      avatar:                  '',
      character_name:          characterName,
      username:                null,
      display_name:            null,
      character_class:         selectedClass,
      character_customization: { skin: skinTone, hair: `${hairStyle}:${hairColor}` },
      rank:                    'Bronze' as const,
      xp:                      0,
      attack_stat:             stats.attack,
      defense_stat:            stats.defense,
      speed_stat:              stats.speed,
      g_earned_lifetime:       0,
      last_active:             now,
      decay_status:            'none' as const,
      decay_frozen_until:      null,
      wins:                    0,
      losses:                  0,
    }

    const { error: dbError } = await supabase.from('players').insert(newPlayer as never)

    if (dbError) {
      if (dbError.code === '23505') {
        const { data } = await supabase.from('players').select('*').eq('wallet_address', walletAddress).single()
        if (data) { setPlayer(data); onCreated(); return }
      }
      setError(dbError.message)
      setPending(false)
      return
    }

    setPlayer({ ...newPlayer, created_at: now })
    onCreated()
  }

  return (
    <div
      className="fixed inset-0 z-[998] overflow-hidden flex flex-col"
      style={{ background: 'linear-gradient(180deg, #04030c 0%, #080512 60%, #0c0618 100%)' }}
    >
      {/* Class accent glow behind character */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        animate={{ opacity: 1 }}
        key={selectedClass}
        initial={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          background: `radial-gradient(ellipse 50% 70% at 30% 60%, ${def.accentColor}22 0%, transparent 65%)`,
        }}
      />

      {/* ─── HEADER ─── */}
      <div className="relative z-10 pt-6 pb-3 px-6 text-center lg:text-left lg:px-12">
        <motion.h1
          className="font-display font-black text-white tracking-[0.08em]"
          style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          FORGE YOUR <span style={{ color: def.accentColor }}>FIGHTER</span>
        </motion.h1>
        <motion.p
          className="text-slate-500 text-sm mt-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Choose your class · Customize your look · Own your legend
        </motion.p>
      </div>

      {/* ─── MAIN ─── */}
      <div className="relative z-10 flex-1 flex flex-col lg:flex-row gap-0 overflow-hidden">

        {/* LEFT — Character preview */}
        <div className="lg:w-[38%] flex flex-col items-center justify-end pb-4 px-4 relative">
          {/* Ground glow */}
          <motion.div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-none"
            animate={{ opacity: 1 }}
            key={selectedClass}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{
              width: 280, height: 200,
              background: `radial-gradient(ellipse 70% 50% at 50% 90%, ${def.accentColor}55 0%, transparent 65%)`,
            }}
          />
          <div className="absolute bottom-[14%] left-1/2 -translate-x-1/2 pointer-events-none"
            style={{ width: 200, height: 1, background: `linear-gradient(90deg, transparent, ${def.accentColor}90 30%, ${def.accentColor} 50%, ${def.accentColor}90 70%, transparent)`, boxShadow: `0 0 12px ${def.accentColor}80` }}
          />

          {/* Character SVG */}
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedClass}
              className="relative flex-1 flex items-end justify-center w-full"
              style={{ maxHeight: 'clamp(240px, 42vh, 380px)' }}
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 10 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <CharacterPreview
                characterClass={selectedClass}
                skinTone={skinTone}
                hairStyle={hairStyle}
                hairColor={hairColor}
                height="100%"
              />
            </motion.div>
          </AnimatePresence>

          {/* Name + class badge */}
          <div className="mt-3 flex flex-col items-center gap-1.5">
            <p className="font-display font-bold text-white text-xl tracking-wider">{characterName}</p>
            <span
              className="text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest"
              style={{ background: def.accentColorDim, color: def.accentColor, border: `1px solid ${def.accentColor}40` }}
            >
              {selectedClass}
            </span>
            {/* Stat mini-bar row */}
            <div className="flex gap-3 mt-1">
              {[
                { label: 'ATK', val: stats.attack, max: 20, color: '#ef4444' },
                { label: 'DEF', val: stats.defense, max: 20, color: '#3b82f6' },
                { label: 'SPD', val: stats.speed,   max: 20, color: '#22c55e' },
              ].map(({ label, val, max, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-bold w-6">{label}</span>
                  <div className="w-16 h-1.5 bg-valor-border rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(val / max) * 100}%`, background: color }} />
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold w-4">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Customization panel */}
        <div className="lg:w-[62%] flex flex-col px-4 lg:px-8 pb-4 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>

          {/* Tabs */}
          <div className="flex gap-1 mb-4 bg-valor-surface/60 rounded-xl p-1 border border-valor-border">
            {(['class', 'look', 'details'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-all ${
                  tab === t ? 'text-black' : 'text-slate-500 hover:text-slate-300'
                }`}
                style={tab === t ? { background: def.accentColor } : {}}
              >
                {t}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {tab === 'class' && (
              <motion.div key="class" {...tabAnim} className="flex flex-col gap-3">
                <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Choose Your Class</p>
                <div className="grid grid-cols-3 gap-3">
                  {CHARACTER_CLASSES.map((cls) => {
                    const d = CLASS_DEFINITIONS[cls]
                    const active = selectedClass === cls
                    return (
                      <motion.button
                        key={cls}
                        onClick={() => setSelectedClass(cls)}
                        whileTap={{ scale: 0.96 }}
                        className="flex flex-col items-center gap-0 rounded-xl border-2 overflow-hidden transition-all relative"
                        style={{
                          borderColor: active ? d.accentColor : '#2a2a3a',
                          background: active ? d.accentColorDim : '#12121a',
                          boxShadow: active ? `0 0 24px ${d.accentColor}35` : 'none',
                        }}
                      >
                        {/* Class warrior preview */}
                        <div className="w-full flex items-end justify-center bg-black/30 py-2" style={{ height: 120 }}>
                          <ClassSilhouette characterClass={cls} height={100} />
                        </div>
                        {/* Class info */}
                        <div className="w-full px-2 py-2 text-center">
                          <p className="font-display font-bold text-white text-sm">{d.name}</p>
                          <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">{d.tagline}</p>
                          <p className="text-[9px] font-bold mt-1.5" style={{ color: d.accentColor }}>{d.weapon}</p>
                        </div>
                        {/* Selected indicator */}
                        {active && (
                          <div className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: d.accentColor }}>
                            <div className="w-2 h-2 rounded-full bg-black" />
                          </div>
                        )}
                      </motion.button>
                    )
                  })}
                </div>

                {/* Class detail card */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedClass}
                    className="rounded-xl p-4 border mt-1"
                    style={{ background: def.accentColorDim, borderColor: `${def.accentColor}30` }}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                  >
                    <p className="text-white text-sm leading-relaxed">{def.description}</p>
                    <div className="mt-3 pt-3 border-t flex gap-4" style={{ borderColor: `${def.accentColor}20` }}>
                      <div>
                        <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Special</p>
                        <p className="text-xs font-bold mt-0.5" style={{ color: def.accentColor }}>{def.special}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{def.specialDesc}</p>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            )}

            {tab === 'look' && (
              <motion.div key="look" {...tabAnim} className="flex flex-col gap-5">
                {/* Skin Tone */}
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-3">Skin Tone</p>
                  <div className="flex gap-2.5 flex-wrap">
                    {SKIN_TONES.map((tone) => (
                      <button
                        key={tone}
                        onClick={() => setSkinTone(tone)}
                        className="rounded-full transition-all"
                        style={{
                          width: 36, height: 36,
                          background: tone,
                          outline: skinTone === tone ? `3px solid white` : `2px solid transparent`,
                          outlineOffset: 2,
                          boxShadow: skinTone === tone ? `0 0 0 4px ${def.accentColor}60` : 'none',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Hair Style */}
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-3">Hair Style</p>
                  <div className="flex gap-2 flex-wrap">
                    {HAIR_STYLE_LABELS.map((label, i) => (
                      <button
                        key={i}
                        onClick={() => setHairStyle(i)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border"
                        style={{
                          background: hairStyle === i ? def.accentColor : '#12121a',
                          color: hairStyle === i ? '#000' : '#9ca3af',
                          borderColor: hairStyle === i ? def.accentColor : '#2a2a3a',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hair Color */}
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-3">Hair Color</p>
                  <div className="flex gap-2.5 flex-wrap">
                    {HAIR_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setHairColor(color)}
                        className="rounded-full transition-all"
                        style={{
                          width: 36, height: 36,
                          background: color,
                          border: `2px solid ${color === '#e8e4f0' ? '#aaa' : color}`,
                          outline: hairColor === color ? `3px solid white` : `2px solid transparent`,
                          outlineOffset: 2,
                          boxShadow: hairColor === color ? `0 0 0 4px ${def.accentColor}60` : 'none',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {tab === 'details' && (
              <motion.div key="details" {...tabAnim} className="flex flex-col gap-5">
                {/* Character name */}
                <div className="bg-valor-surface rounded-xl p-4 border border-valor-border">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Character Name</p>
                  <p className="font-display font-bold text-xl" style={{ color: def.accentColor }}>{characterName}</p>
                  <p className="text-xs text-slate-600 mt-1">Forged from your wallet. Change it later in Settings.</p>
                </div>

                {/* Play Style */}
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-3">Play Style</p>
                  <div className="flex flex-col gap-2">
                    {(['Wanderer', 'Fighter', 'Champion'] as PlayStyle[]).map((ps) => (
                      <button
                        key={ps}
                        onClick={() => setPlayStyle(ps)}
                        className="flex items-center gap-3 p-3 rounded-xl border text-left transition-all"
                        style={{
                          background: playStyle === ps ? def.accentColorDim : '#12121a',
                          borderColor: playStyle === ps ? def.accentColor : '#2a2a3a',
                        }}
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0 border-2"
                          style={{
                            background: playStyle === ps ? def.accentColor : 'transparent',
                            borderColor: playStyle === ps ? def.accentColor : '#4a4a5a',
                          }}
                        />
                        <div>
                          <p className="font-bold text-white text-sm">{ps}</p>
                          <p className="text-xs text-slate-500">{PLAY_STYLE_LABELS[ps]}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ─── FORGE BUTTON ─── */}
      <div className="relative z-10 px-4 lg:px-8 pb-6 pt-3 border-t border-valor-border/40 bg-valor-dark/60 backdrop-blur-sm flex flex-col items-center gap-2">
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <motion.button
          onClick={handleCreate}
          disabled={pending}
          whileHover={{ scale: 1.04, filter: 'brightness(1.12)' }}
          whileTap={{ scale: 0.96 }}
          className="w-full max-w-sm font-display font-black uppercase tracking-[0.15em] py-4 text-base relative"
          style={{
            background: pending ? '#4a4a4a' : `linear-gradient(135deg, ${def.accentColor}ee 0%, ${def.accentColor} 50%, ${def.accentColorDim.replace('0.12','0.8').replace('rgba','rgb').replace(',0.8)','')} 100%)`,
            color: pending ? '#888' : '#000',
            clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)',
            boxShadow: pending ? 'none' : `0 0 30px ${def.accentColor}50`,
          }}
        >
          {pending ? (
            <span className="flex items-center justify-center gap-2">
              <motion.span className="w-4 h-4 rounded-full border-2 border-black border-t-transparent inline-block" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
              Forging...
            </span>
          ) : (
            `Forge ${characterName}`
          )}
        </motion.button>
        <p className="text-slate-700 text-[9px] tracking-widest uppercase">One character per wallet · No duplicates</p>
      </div>
    </div>
  )
}

const tabAnim = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22 },
}
