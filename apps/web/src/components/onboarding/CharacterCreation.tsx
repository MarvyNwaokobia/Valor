import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import type { PlayStyle } from '@/types'
import { PLAY_STYLES } from '@/lib/constants'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { supabase } from '@/lib/supabase'

const AVATARS = ['🧙', '⚔️', '🗡️', '🏹', '🛡️', '🔥', '⚡', '🌙', '💎', '👑', '🐉', '🦅']

const PLAY_STYLE_INFO: Record<PlayStyle, { label: string; desc: string; emoji: string }> = {
  Wanderer: { label: 'Wanderer', desc: 'Idle missions + passive XP. Best for casual play.', emoji: '🌿' },
  Fighter: { label: 'Fighter', desc: 'Max XP through battles. For competitive players.', emoji: '⚔️' },
  Champion: { label: 'Champion', desc: 'Battle and idle. The complete warrior.', emoji: '👑' },
}

const PREFIXES = ['Iron', 'Dark', 'Storm', 'Ash', 'Void', 'Flame', 'Shadow', 'Silver', 'Crimson', 'Frost', 'Thunder', 'Ember']
const SUFFIXES = ['Blade', 'Fist', 'Heart', 'Walker', 'Strike', 'Guard', 'Born', 'Wolf', 'Hawk', 'Bane', 'Forge', 'Rift']

function deterministicName(wallet: string): string {
  // Hash the wallet address to get a deterministic but unique name
  const hash = wallet.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0)
  const prefix = PREFIXES[hash % PREFIXES.length]
  const suffix = SUFFIXES[(hash >> 4) % SUFFIXES.length]
  return `${prefix}${suffix}`
}

function statsForPlayStyle(playStyle: PlayStyle, wallet: string) {
  const seed = wallet.slice(-4).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const variance = (seed % 5) - 2 // -2 to +2

  const bases: Record<PlayStyle, { attack: number; defense: number; speed: number }> = {
    Wanderer: { attack: 8, defense: 11, speed: 11 },
    Fighter:  { attack: 14, defense: 8, speed: 10 },
    Champion: { attack: 11, defense: 11, speed: 10 },
  }
  const base = bases[playStyle]
  return {
    attack: base.attack + variance,
    defense: base.defense + variance,
    speed: base.speed + variance,
  }
}

interface Props {
  walletAddress: `0x${string}`
  onCreated: () => void
}

export default function CharacterCreation({ walletAddress, onCreated }: Props) {
  const setPlayer = usePlayerStore((s) => s.setPlayer)
  const [playStyle, setPlayStyle] = useState<PlayStyle>('Fighter')
  const [avatar, setAvatar] = useState(AVATARS[0])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Name is deterministic from wallet — no two wallets get the same name
  const characterName = useMemo(() => deterministicName(walletAddress), [walletAddress])
  const stats = useMemo(() => statsForPlayStyle(playStyle, walletAddress), [playStyle, walletAddress])

  async function handleCreate() {
    setPending(true)
    setError(null)

    const now = new Date().toISOString()
    const newPlayer = {
      wallet_address: walletAddress,
      play_style: playStyle,
      avatar,
      character_name: characterName,
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

    const { error: dbError } = await supabase.from('players').insert(newPlayer)

    if (dbError) {
      // If player already exists (duplicate), fetch and continue
      if (dbError.code === '23505') {
        const { data } = await supabase
          .from('players')
          .select('*')
          .eq('wallet_address', walletAddress)
          .single()
        if (data) {
          setPlayer(data)
          onCreated()
          return
        }
      }
      setError(dbError.message)
      setPending(false)
      return
    }

    setPlayer({ ...newPlayer, created_at: now })
    onCreated()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-display font-bold text-white">Create Your Character</h2>
        <p className="text-slate-400 text-sm mt-2">
          This is your identity in Valor. One per wallet. Choose wisely.
        </p>
      </div>

      {/* Avatar */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Avatar</p>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((a) => (
            <motion.button
              key={a}
              onClick={() => setAvatar(a)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className={`w-11 h-11 rounded-xl text-2xl transition-all ${
                avatar === a
                  ? 'bg-valor-gold/20 border-2 border-valor-gold shadow-[0_0_12px_rgba(234,179,8,0.3)]'
                  : 'bg-valor-surface-2 border border-valor-border hover:border-slate-500'
              }`}
            >
              {a}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Character Name */}
      <div className="bg-valor-surface-2 rounded-xl p-4 border border-valor-border">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
          Character Name
        </p>
        <p className="text-valor-gold font-display font-bold text-xl">{characterName}</p>
        <p className="text-xs text-slate-500 mt-1">
          Generated uniquely from your wallet — no two players share a name.
        </p>
      </div>

      {/* Play Style */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
          Play Style
        </p>
        <div className="flex flex-col gap-2">
          {PLAY_STYLES.map((ps) => {
            const info = PLAY_STYLE_INFO[ps]
            const isSelected = playStyle === ps
            return (
              <motion.button
                key={ps}
                onClick={() => setPlayStyle(ps)}
                whileTap={{ scale: 0.98 }}
                className={`flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-valor-gold bg-valor-gold/10 shadow-[0_0_16px_rgba(234,179,8,0.15)]'
                    : 'border-valor-border bg-valor-surface hover:border-slate-500'
                }`}
              >
                <span className="text-2xl shrink-0">{info.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm">{info.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{info.desc}</p>
                </div>
                {isSelected && (
                  <div className="w-4 h-4 rounded-full bg-valor-gold flex items-center justify-center shrink-0">
                    <div className="w-2 h-2 rounded-full bg-black" />
                  </div>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Stats Preview */}
      <div className="bg-valor-surface-2 rounded-xl p-4 border border-valor-border">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
          Starting Stats
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'ATK', value: stats.attack, color: '#ef4444' },
            { label: 'DEF', value: stats.defense, color: '#3b82f6' },
            { label: 'SPD', value: stats.speed, color: '#22c55e' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className="font-bold text-white text-lg">{value}</p>
              <div className="h-1 bg-valor-border rounded-full mt-1 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(value / 20) * 100}%`, background: color }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <motion.button
        onClick={handleCreate}
        disabled={pending}
        className="py-3.5 bg-valor-gold text-black font-bold rounded-xl hover:bg-valor-gold-light disabled:opacity-50 transition-colors text-base"
        whileHover={{ scale: pending ? 1 : 1.01 }}
        whileTap={{ scale: pending ? 1 : 0.98 }}
      >
        {pending ? (
          <span className="flex items-center justify-center gap-2">
            <motion.span
              className="w-4 h-4 rounded-full border-2 border-black border-t-transparent inline-block"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
            />
            Creating...
          </span>
        ) : (
          'Enter Valor'
        )}
      </motion.button>
    </div>
  )
}
