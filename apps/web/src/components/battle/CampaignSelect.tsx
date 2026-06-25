'use client'

import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronLeft, Lock, Skull, Check, Crosshair } from 'lucide-react'
import type { Player } from '@/types'
import { CAMPAIGN_LEVELS } from '@/engine/campaign/levels'
import { GUN_CATALOG } from '@/engine/combat'

interface Props {
  player: Player
  onBack: () => void
}

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: 'Easy', medium: 'Normal', hard: 'Hard', boss: 'Brutal',
}

/**
 * PvE Campaign level select. The next playable level is pve_level + 1; cleared
 * levels are replayable for XP; later levels are locked. Picking one starts a
 * Campaign fight via /fight?level=N (the level sets the enemy gun/HP/difficulty).
 */
export default function CampaignSelect({ player, onBack }: Props) {
  const router = useRouter()
  const cleared = player.pve_level ?? 0
  const nextLevel = cleared + 1

  const play = (n: number) => {
    const el = document.documentElement
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {})
    router.push(`/fight?level=${n}`)
  }

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: '#04030c' }}>
      <div className="max-w-2xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-4">
          <ChevronLeft size={16} /> Back
        </button>

        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-red-400 mb-1">PvE Campaign</p>
          <h1 className="font-display font-black text-white text-3xl">Choose a Level</h1>
          <p className="text-slate-500 text-sm mt-1">
            {cleared}/{CAMPAIGN_LEVELS.length} cleared · beat a level to unlock the next
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          {CAMPAIGN_LEVELS.map((lvl) => {
            const isCleared = lvl.level <= cleared
            const isNext = lvl.level === nextLevel
            const locked = lvl.level > nextLevel
            const gun = GUN_CATALOG[lvl.enemyGun]
            const accent = lvl.isBoss ? '#ef4444' : isNext ? '#eab308' : '#3b82f6'

            return (
              <motion.button
                key={lvl.level}
                onClick={() => !locked && play(lvl.level)}
                disabled={locked}
                whileHover={locked ? undefined : { scale: 1.01 }}
                whileTap={locked ? undefined : { scale: 0.99 }}
                className="group relative overflow-hidden p-4 rounded-xl border text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgba(8,8,14,0.9)', borderColor: isNext ? 'rgba(234,179,8,0.5)' : 'rgba(42,42,58,0.8)' }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-11 h-11 rounded-lg flex items-center justify-center font-display font-black text-lg shrink-0"
                    style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}44` }}
                  >
                    {locked ? <Lock size={18} /> : isCleared ? <Check size={20} /> : lvl.level}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-display font-black text-white text-base truncate">{lvl.name}</p>
                      {lvl.isBoss && <Skull size={14} className="text-red-400 shrink-0" />}
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5 flex items-center gap-1.5">
                      <Crosshair size={11} /> {gun.name} · {DIFFICULTY_LABEL[lvl.difficulty] ?? lvl.difficulty} · +{lvl.xpReward} XP
                    </p>
                  </div>
                  {isNext && (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md shrink-0"
                      style={{ background: '#eab308', color: '#000' }}>
                      Play
                    </span>
                  )}
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
