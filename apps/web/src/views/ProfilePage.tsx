'use client'

import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { motion } from 'framer-motion'
import { usePlayerStore } from '@/stores/usePlayerStore'
import InventoryPanel from '@/components/player-card/InventoryPanel'
import DailyClaimButton from '@/components/player-card/DailyClaimButton'
import DecayPanel from '@/components/player-card/DecayPanel'
import IdlePanel from '@/components/idle/IdlePanel'
import BattleHistory from '@/components/profile/BattleHistory'
import { CLASS_DEFINITIONS } from '@/lib/classes'
import { XP_PER_RANK } from '@/lib/constants'
import type { Rank } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'

const CLASS_SOLO: Record<string, string> = {
  Berserker: '/characters/Berserkers.png',
  Sentinel:  '/characters/Sentinel.png',
  Phantom:   '/characters/Phanthom.png',
}

export default function ProfilePage() {
  const { address } = useAccount()
  const router      = useRouter()
  const player      = usePlayerStore(s => s.player)
  const inventory   = usePlayerStore(s => s.inventory)

  if (!address || !player) { router.replace('/'); return null }

  const charClass  = player.character_class ?? 'Berserker'
  const def        = CLASS_DEFINITIONS[charClass as keyof typeof CLASS_DEFINITIONS] ?? CLASS_DEFINITIONS['Berserker']
  const heroImg    = CLASS_SOLO[charClass]
  const xpProgress = (player.xp / XP_PER_RANK) * 100

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">

      {/* ── LEFT — Character art hero card ──────────────────────────── */}
      <motion.div
        className="lg:sticky lg:top-20 w-full lg:w-72 shrink-0 flex flex-col gap-3"
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.55, ease: [0.16,1,0.3,1] }}
      >
        {/* Portrait card */}
        <div className="relative rounded-2xl overflow-hidden" style={{ height: 380 }}>
          {/* Atmosphere */}
          <div className="absolute inset-0" style={{
            background: `radial-gradient(ellipse 80% 90% at 50% 60%, ${def.accentColor}20, transparent)`,
          }}/>
          {/* Character image */}
          <img src={heroImg} alt={player.character_class ?? 'Warrior'}
            className="absolute inset-0 w-full h-full object-cover object-top select-none"
            style={{ filter: `contrast(1.05) drop-shadow(0 0 24px ${def.glowColor})` }}
          />
          {/* Bottom fade */}
          <div className="absolute inset-x-0 bottom-0 h-44 pointer-events-none" style={{
            background: 'linear-gradient(0deg, rgba(4,3,12,1) 0%, rgba(4,3,12,0.6) 50%, transparent 100%)',
          }}/>
          {/* Top class accent line */}
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: def.accentColor }}/>
          {/* Scanlines */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px)',
          }}/>

          {/* Name + stats overlay */}
          <div className="absolute inset-x-0 bottom-0 p-4 flex flex-col gap-2.5">
            <div className="flex items-end justify-between">
              <div>
                <p className="font-display font-black text-white text-xl tracking-wider leading-none">
                  {player.character_name}
                </p>
                <span className="text-[9px] font-black uppercase tracking-[0.18em] px-2 py-0.5 rounded-sm mt-1.5 inline-block"
                  style={{ background: def.accentColorDim, color: def.accentColor, border: `1px solid ${def.accentColor}40` }}>
                  {player.character_class}
                </span>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-slate-500 uppercase tracking-wider">Rank</p>
                <p className="font-display font-black text-xl" style={{ color: def.accentColor }}>{player.rank}</p>
              </div>
            </div>

            {/* XP bar */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[9px] text-slate-600 uppercase tracking-wider">
                <span>{player.xp.toLocaleString()} XP</span>
                <span>{XP_PER_RANK.toLocaleString()} next</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(42,42,58,0.8)' }}>
                <motion.div className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${def.accentColor}99, ${def.accentColor})` }}
                  initial={{ width: 0 }} animate={{ width: `${xpProgress}%` }}
                  transition={{ duration: 0.7, delay: 0.3 }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: 'ATK', v: player.attack_stat,  c: '#ef4444' },
            { l: 'DEF', v: player.defense_stat, c: '#3b82f6' },
            { l: 'SPD', v: player.speed_stat,   c: '#22c55e' },
          ].map(({ l, v, c }) => (
            <div key={l} className="flex flex-col items-center py-3 rounded-xl border"
              style={{ background: `${c}08`, borderColor: `${c}20` }}>
              <span className="text-[8px] uppercase tracking-widest font-bold mb-0.5" style={{ color: c }}>{l}</span>
              <span className="font-display font-black text-white text-lg leading-none">{v}</span>
            </div>
          ))}
        </div>

        {/* G$ earned */}
        <div className="flex items-center justify-between px-4 py-3 rounded-xl border"
          style={{ background: 'rgba(234,179,8,0.06)', borderColor: 'rgba(234,179,8,0.2)' }}>
          <div>
            <p className="text-[9px] uppercase tracking-widest text-amber-500/60 font-bold">Lifetime G$</p>
            <p className="font-black text-amber-400 text-lg">{formatGDollarNumber(player.g_earned_lifetime)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">Record</p>
            <p className="text-sm font-black text-white">
              <span className="text-green-400">{player.wins}W</span>
              <span className="text-slate-700 mx-1">/</span>
              <span className="text-red-400">{player.losses}L</span>
            </p>
          </div>
        </div>

        {/* Daily claim */}
        <DailyClaimButton walletAddress={address} />

        {/* Decay panel */}
        <DecayPanel walletAddress={address} />
      </motion.div>

      {/* ── RIGHT — Panels ──────────────────────────────────────────── */}
      <motion.div
        className="flex-1 flex flex-col gap-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.12 }}
      >
        {/* Page header */}
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold" style={{ color: def.accentColor }}>
            Warrior File
          </p>
          <h1 className="font-display font-black text-white text-2xl tracking-wide">Profile</h1>
        </div>

        {(player.play_style === 'Wanderer' || player.play_style === 'Champion') && (
          <IdlePanel walletAddress={address} player={player} />
        )}
        <InventoryPanel inventory={inventory} walletAddress={address} />
        <BattleHistory walletAddress={address} playerRank={player.rank as Rank} />
      </motion.div>
    </div>
  )
}
