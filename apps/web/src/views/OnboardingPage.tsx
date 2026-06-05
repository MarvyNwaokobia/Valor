'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { useConnection } from 'wagmi'
import { usePlayerStore } from '@/stores/usePlayerStore'

import IdentityVerification from '@/components/onboarding/IdentityVerification'
import CharacterSelectScreen, { type Gender } from '@/components/onboarding/CharacterSelectScreen'
import TutorialArena from '@/components/onboarding/TutorialArena'
import { CLASS_DEFINITIONS, CHARACTER_GLB, statVarianceFromWallet } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'
import CharacterViewer from '@/components/warrior/CharacterViewer'

type Step = 'verify' | 'covenant' | 'select' | 'confirm' | 'tutorial'

const PREFIXES = ['Iron','Dark','Storm','Ash','Void','Flame','Shadow','Silver','Crimson','Frost','Thunder','Ember','Blood','Death','War']
const SUFFIXES = ['Blade','Fist','Heart','Walker','Strike','Guard','Born','Wolf','Hawk','Bane','Forge','Rift','Claw','Rage','Fire']

function deterministicName(wallet: string) {
  const seed = wallet.replace('0x', '').slice(0, 8)
  const hash = seed.split('').reduce((acc, ch) => ((acc * 31 + ch.charCodeAt(0)) >>> 0), 7)
  return `${PREFIXES[hash % PREFIXES.length]}${SUFFIXES[(hash >> 4) % SUFFIXES.length]}`
}

export default function OnboardingPage() {
  const { address } = useConnection()
  const router       = useRouter()
  const setPlayer    = usePlayerStore(s => s.setPlayer)
  const player       = usePlayerStore(s => s.player)

  // DEV BYPASS: skip GoodDollar verify for testing — restore to 'verify' before launch
  const [step,           setStep]           = useState<Step>('covenant')
  const [createdPlayer,  setCreatedPlayer]  = useState<null | Parameters<typeof TutorialArena>[0]['player']>(null)
  const [selectedClass, setSelectedClass] = useState<CharacterClass>('Berserker')
  const [selectedGender, setSelectedGender] = useState<Gender>('male')
  const [pending,       setPending]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  if (player) { router.replace('/'); return null }

  if (!address) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-white font-display text-xl font-bold">Sign In to Play</p>
        <p className="text-slate-400 text-sm mt-2">Use the button in the top right to sign in and begin.</p>
      </div>
    )
  }

  // ── Step: COVENANT — permanent identity intro (auto-advance to 'select') ──────
  if (step === 'covenant') {
    return <CovenantIntro onComplete={() => setStep('select')} />
  }

  // ── Step: SELECT ──────────────────────────────────────────────────────────────

  if (step === 'select') {
    return (
      <CharacterSelectScreen
        onSelect={(cls, gen) => {
          setSelectedClass(cls)
          setSelectedGender(gen)
          setStep('confirm')
        }}
      />
    )
  }

  // ── Step: CONFIRM ─────────────────────────────────────────────────────────────

  if (step === 'confirm') {
    const def           = CLASS_DEFINITIONS[selectedClass]
    const variance      = statVarianceFromWallet(address)
    const characterName = deterministicName(address)
    const stats         = {
      attack:  def.stats.attack  + variance,
      defense: def.stats.defense + variance,
      speed:   def.stats.speed   + variance,
    }

    async function handleCreate() {
      if (!address) return
      setPending(true); setError(null)
      const now = new Date().toISOString()
      const newPlayer = {
        wallet_address:          address,
        play_style:              'Fighter' as const,
        avatar:                  '',
        character_name:          characterName,
        username:                null,
        display_name:            null,
        character_class:         selectedClass,
        character_customization: {},
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPlayer),
      })
      if (!res.ok) {
        setError('Failed to create player. Please try again.'); setPending(false); return
      }
      const created = await res.json()
      setPlayer(created)
      setCreatedPlayer(created)
      setStep('tutorial')
    }

    return (
      <div className="fixed inset-0 z-60 overflow-hidden" style={{ background: '#04030c' }}>

        {/* Atmosphere */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2" style={{
            width: '90%', height: '60%',
            background: `radial-gradient(ellipse at 50% 100%, ${def.accentColor}22 0%, transparent 65%)`,
          }} />
          <div className="absolute inset-x-0 top-0" style={{
            height: '30%',
            background: 'linear-gradient(180deg, rgba(4,3,12,0.9) 0%, transparent 100%)',
          }} />
          <div className="absolute inset-x-0 bottom-0" style={{
            height: '48%',
            background: 'linear-gradient(0deg, rgba(4,3,12,0.99) 0%, rgba(4,3,12,0.85) 55%, transparent 100%)',
          }} />
        </div>

        {/* Back button */}
        <button
          onClick={() => setStep('select')}
          className="absolute top-5 left-5 z-20 flex items-center gap-2 text-slate-500 hover:text-white transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest">Change Class</span>
        </button>

        {/* 3D character fills the screen */}
        <CharacterViewer
          glbPath={CHARACTER_GLB[selectedClass]}
          accentColor={def.accentColor}
          animationName="idle"
          modelKey={`confirm-${selectedClass}-${selectedGender}`}
          className="absolute inset-0"
        />

        {/* Bottom panel */}
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col px-5 gap-4"
          style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))' }}>

          {/* Name + class */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <h2
              className="font-display font-black leading-none"
              style={{
                fontSize: 'clamp(2.2rem, 7vw, 3.5rem)',
                color: def.accentColor,
                textShadow: `0 0 32px ${def.accentColor}`,
              }}
            >
              {characterName}
            </h2>
            <p className="font-display font-bold uppercase mt-1" style={{
              fontSize: '10px', letterSpacing: '0.28em', color: 'rgba(255,255,255,0.35)',
            }}>
              {def.name} · {def.tagline}
            </p>
            <p className="font-display font-bold uppercase mt-2" style={{
              fontSize: '8px', letterSpacing: '0.28em', color: 'rgba(255,255,255,0.18)',
            }}>
              ⬡ Permanently bound to your wallet
            </p>
          </motion.div>

          {/* Stats row */}
          <motion.div
            className="flex gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
          >
            {[
              { l: 'ATK', v: stats.attack,  c: '#ef4444' },
              { l: 'DEF', v: stats.defense, c: '#3b82f6' },
              { l: 'SPD', v: stats.speed,   c: '#22c55e' },
            ].map(({ l, v, c }) => (
              <div
                key={l}
                className="flex-1 rounded-xl px-3 py-2.5 border flex flex-col items-center gap-0.5"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: `${c}22` }}
              >
                <span className="font-black text-white text-xl leading-none">{v}</span>
                <span className="font-bold uppercase text-[9px] tracking-widest" style={{ color: c }}>{l}</span>
              </div>
            ))}
          </motion.div>

          {/* Special ability teaser */}
          <motion.div
            className="rounded-xl px-4 py-2.5 border"
            style={{ background: def.accentColorDim, borderColor: `${def.accentColor}25` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.14 }}
          >
            <p style={{ fontSize: '8px', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}
              className="uppercase font-bold mb-0.5">
              Special Ability
            </p>
            <p className="font-display font-black text-sm" style={{ color: def.accentColor }}>
              {def.special}
            </p>
            <p className="text-slate-500 text-xs mt-0.5">{def.specialDesc}</p>
          </motion.div>

          {error && (
            <p className="text-red-400 text-xs text-center">{error}</p>
          )}

          {/* CTA */}
          <motion.button
            onClick={handleCreate}
            disabled={pending}
            whileHover={{ scale: 1.02, filter: 'brightness(1.12)' }}
            whileTap={{ scale: 0.97 }}
            className="relative overflow-hidden font-display font-black uppercase w-full disabled:opacity-50 mb-2"
            style={{
              fontSize: 'clamp(13px, 2.6vw, 16px)',
              letterSpacing: '0.24em',
              color: '#080610',
              padding: 'clamp(16px, 3vw, 20px) 0',
              background: `linear-gradient(135deg, ${def.accentColor}ee, ${def.accentColor})`,
              clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)',
              boxShadow: `0 0 36px ${def.accentColor}55, 0 6px 24px rgba(0,0,0,0.9)`,
            }}
          >
            {/* Shimmer */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(108deg, transparent 28%, rgba(255,255,255,0.25) 50%, transparent 72%)' }}
              animate={{ x: ['-140%', '220%'] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'linear', repeatDelay: 2.5 }}
            />
            {pending ? 'Forging Your Legacy...' : 'Forge Your Legacy'}
          </motion.button>
        </div>
      </div>
    )
  }

  // ── Step: TUTORIAL ───────────────────────────────────────────────────────────
  if (step === 'tutorial' && createdPlayer) {
    return (
      <TutorialArena
        player={createdPlayer}
        onComplete={() => router.replace('/')}
      />
    )
  }

  // ── Step: VERIFY ──────────────────────────────────────────────────────────────

  return (
    <div className="max-w-xl mx-auto py-8">
      <IdentityVerification walletAddress={address} onVerified={() => setStep('select')} />
    </div>
  )
}

// ── Covenant intro — "One Verified Human. One Warrior." ───────────────────────

const LINES = [
  { text: 'ONE VERIFIED HUMAN',   delay: 0    },
  { text: 'ONE WARRIOR',          delay: 0.45 },
  { text: 'FOREVER',              delay: 0.8  },
]

function CovenantIntro({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 1200)
    const t2 = setTimeout(() => setPhase('out'),  2200)
    const t3 = setTimeout(onComplete,             2900)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onComplete])

  return (
    <motion.div
      className="fixed inset-0 z-70 flex flex-col items-center justify-center gap-3"
      style={{ background: '#04030c' }}
      animate={phase === 'out' ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: 0.6 }}
    >
      {/* Background bloom */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(234,179,8,0.12), transparent)' }}
        animate={phase === 'hold' ? { opacity: [0.6, 1, 0.6] } : { opacity: 0.6 }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {LINES.map(({ text, delay }) => (
        <motion.p
          key={text}
          className="font-display font-black text-center"
          style={{
            fontSize: 'clamp(1.4rem, 5vw, 2.6rem)',
            letterSpacing: '0.18em',
            color: text === 'FOREVER' ? '#eab308' : 'rgba(255,255,255,0.85)',
            textShadow: text === 'FOREVER' ? '0 0 40px rgba(234,179,8,0.5)' : undefined,
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          {text}
        </motion.p>
      ))}

      {/* Horizontal rule */}
      <motion.div
        className="h-px w-32 mt-2"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(234,179,8,0.6), transparent)' }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
        transition={{ delay: 1.0, duration: 0.5 }}
      />
    </motion.div>
  )
}
