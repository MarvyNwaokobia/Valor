import { useState } from 'react'
import { motion } from 'framer-motion'
import type { PlayStyle } from '@/types'
import { PLAY_STYLES } from '@/lib/constants'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { supabase } from '@/lib/supabase'

const AVATARS = ['🧙', '⚔️', '🗡️', '🏹', '🛡️', '🔥', '⚡', '🌙', '💎', '👑']

const PLAY_STYLE_INFO: Record<PlayStyle, { label: string; desc: string; emoji: string }> = {
  Wanderer: { label: 'Wanderer', desc: 'Idle missions + passive earnings. Best for casual play.', emoji: '🌿' },
  Fighter: { label: 'Fighter', desc: 'Max XP from battles. Best for competitive players.', emoji: '⚔️' },
  Champion: { label: 'Champion', desc: 'Both battle and idle. The complete warrior.', emoji: '👑' },
}

function generateStats(playStyle: PlayStyle) {
  const bases: Record<PlayStyle, { attack: number; defense: number; speed: number }> = {
    Wanderer: { attack: 8, defense: 10, speed: 12 },
    Fighter: { attack: 14, defense: 8, speed: 10 },
    Champion: { attack: 11, defense: 11, speed: 10 },
  }
  const base = bases[playStyle]
  return {
    attack: base.attack + Math.floor(Math.random() * 4),
    defense: base.defense + Math.floor(Math.random() * 4),
    speed: base.speed + Math.floor(Math.random() * 4),
  }
}

function generateName(): string {
  const prefixes = ['Iron', 'Dark', 'Storm', 'Ash', 'Void', 'Flame', 'Shadow', 'Silver']
  const suffixes = ['Blade', 'Fist', 'Heart', 'Walker', 'Strike', 'Guard', 'Born', 'Wolf']
  return `${prefixes[Math.floor(Math.random() * prefixes.length)]}${suffixes[Math.floor(Math.random() * suffixes.length)]}`
}

interface Props {
  walletAddress: string
  onCreated: () => void
}

export default function CharacterCreation({ walletAddress, onCreated }: Props) {
  const setPlayer = usePlayerStore((s) => s.setPlayer)
  const [playStyle, setPlayStyle] = useState<PlayStyle>('Fighter')
  const [avatar, setAvatar] = useState(AVATARS[0])
  const [name] = useState(generateName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stats = generateStats(playStyle)

  async function handleCreate() {
    setPending(true)
    setError(null)

    const now = new Date().toISOString()
    const player = {
      wallet_address: walletAddress,
      play_style: playStyle,
      avatar,
      character_name: name,
      rank: 'Bronze' as const,
      xp: 0,
      attack_stat: stats.attack,
      defense_stat: stats.defense,
      speed_stat: stats.speed,
      g_earned_lifetime: 0,
      last_active: now,
      decay_status: 'none' as const,
      decay_frozen_until: null,
      wins: 0,
      losses: 0,
    }

    const { error: dbError } = await supabase.from('players').insert(player)

    if (dbError) {
      setError(dbError.message)
      setPending(false)
      return
    }

    setPlayer({ ...player, created_at: now })
    onCreated()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-display font-bold text-white">Create Your Character</h2>
        <p className="text-slate-400 text-sm mt-2">
          This is your identity in Valor. Choose wisely.
        </p>
      </div>

      {/* Avatar selection */}
      <div>
        <p className="text-sm font-bold text-white mb-2">Avatar</p>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((a) => (
            <button
              key={a}
              onClick={() => setAvatar(a)}
              className={`w-10 h-10 rounded-lg text-xl transition-all ${
                avatar === a
                  ? 'bg-valor-gold/20 border-2 border-valor-gold scale-110'
                  : 'bg-valor-surface-2 border border-valor-border hover:border-slate-500'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Character name */}
      <div>
        <p className="text-sm font-bold text-white mb-1">Character Name</p>
        <p className="text-valor-gold font-display font-bold text-lg">{name}</p>
        <p className="text-xs text-slate-500 mt-0.5">Name is generated — unique to your wallet.</p>
      </div>

      {/* Play style */}
      <div>
        <p className="text-sm font-bold text-white mb-2">Play Style</p>
        <div className="flex flex-col gap-2">
          {PLAY_STYLES.map((ps) => {
            const info = PLAY_STYLE_INFO[ps]
            return (
              <button
                key={ps}
                onClick={() => setPlayStyle(ps)}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  playStyle === ps
                    ? 'border-valor-gold bg-valor-gold/10'
                    : 'border-valor-border bg-valor-surface hover:border-slate-500'
                }`}
              >
                <span className="text-2xl">{info.emoji}</span>
                <div>
                  <p className="font-bold text-white text-sm">{info.label}</p>
                  <p className="text-xs text-slate-400">{info.desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Starting stats preview */}
      <div className="bg-valor-surface-2 rounded-xl p-4">
        <p className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Starting Stats</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div><p className="text-xs text-slate-500">ATK</p><p className="font-bold text-white">{stats.attack}</p></div>
          <div><p className="text-xs text-slate-500">DEF</p><p className="font-bold text-white">{stats.defense}</p></div>
          <div><p className="text-xs text-slate-500">SPD</p><p className="font-bold text-white">{stats.speed}</p></div>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <motion.button
        onClick={handleCreate}
        disabled={pending}
        className="py-3 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light disabled:opacity-50 transition-colors"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {pending ? 'Creating...' : 'Enter Valor'}
      </motion.button>
    </div>
  )
}
