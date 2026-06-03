import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useConnection } from 'wagmi'
import type { Player } from '@/types'
import { RANK_COLORS, XP_PER_RANK } from '@/lib/constants'
import { getDecayStatus } from '@/utils/decay'
import { formatGDollarNumber, formatTimeAgo } from '@/utils/format'
import { useGBalance } from '@/hooks/useGBalance'
import XpMeter from './XpMeter'
import RankBadge from './RankBadge'
import DecayOverlay from './DecayOverlay'
import AchievementSlots from './AchievementSlots'

interface Props {
  player: Player
  isPublic?: boolean
  showShareLink?: boolean
}

export default function PlayerCard({ player, isPublic = false, showShareLink = false }: Props) {
  const decayStatus = getDecayStatus(player.last_active, player.decay_frozen_until)
  const rankColor = RANK_COLORS[player.rank]
  const isDecaying = decayStatus === 'active'
  const isWarning = decayStatus === 'warning'

  // Only fetch live balance on the owner's own card (not public view)
  const { address } = useConnection()
  const isOwner = !isPublic && address?.toLowerCase() === player.wallet_address.toLowerCase()
  const { formatted: liveBalance } = useGBalance(isOwner ? (player.wallet_address as `0x${string}`) : undefined)

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/card/${player.wallet_address}`
      : `/card/${player.wallet_address}`

  return (
    <motion.div
      className={`relative rounded-2xl overflow-hidden border-2 bg-valor-surface transition-all ${
        isDecaying
          ? 'border-red-800/70'
          : isWarning
            ? 'border-orange-700/60'
            : 'border-valor-border'
      }`}
      style={
        isDecaying
          ? { filter: 'saturate(0.35) brightness(0.75)' }
          : { boxShadow: `0 0 24px ${rankColor}1a, 0 0 48px ${rankColor}0a` }
      }
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Rank-colored header bar */}
      <div
        className="h-1.5 w-full"
        style={{ background: `linear-gradient(90deg, ${rankColor}66, ${rankColor})` }}
      />

      {/* Rank glow overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${rankColor}08 0%, transparent 60%)`,
        }}
      />

      {isDecaying && <DecayOverlay status="active" />}
      {isWarning && <DecayOverlay status="warning" />}

      <div className="p-5 flex flex-col gap-4 relative z-10">
        {/* Avatar + identity row */}
        <div className="flex items-center gap-3">
          <motion.div
            className="relative w-16 h-16 rounded-full flex items-center justify-center text-3xl border-2 shrink-0"
            style={{ borderColor: rankColor, boxShadow: `0 0 12px ${rankColor}44` }}
            whileHover={{ scale: 1.05 }}
          >
            {player.avatar}
            {/* Rank indicator pip */}
            <div
              className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-valor-surface"
              style={{ background: rankColor }}
            />
          </motion.div>

          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-white text-base truncate">
              {player.character_name}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <RankBadge rank={player.rank} />
              <span className="text-xs text-slate-500 capitalize">{player.play_style}</span>
            </div>
          </div>

          {/* Win rate pill */}
          {(player.wins + player.losses) > 0 && (
            <div className="text-right shrink-0">
              <p className="text-xs text-slate-500">Win Rate</p>
              <p className="text-sm font-bold text-white">
                {Math.round((player.wins / (player.wins + player.losses)) * 100)}%
              </p>
            </div>
          )}
        </div>

        {/* XP Meter */}
        <XpMeter xp={player.xp} max={XP_PER_RANK} rank={player.rank} />

        {/* Stat grid */}
        <div className="grid grid-cols-3 gap-2">
          <StatBox label="ATK" value={player.attack_stat} color="#ef4444" />
          <StatBox label="DEF" value={player.defense_stat} color="#3b82f6" />
          <StatBox label="SPD" value={player.speed_stat} color="#22c55e" />
        </div>

        {/* W/L + G$ balance / lifetime earnings */}
        <div className="flex items-center justify-between text-sm border-t border-valor-border pt-3">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-xs">
              <span className="text-green-400 font-bold">{player.wins}W</span>
              {' '}
              <span className="text-slate-600">/</span>
              {' '}
              <span className="text-red-400 font-bold">{player.losses}L</span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            {liveBalance && (
              <span className="font-bold text-valor-gold text-sm">{liveBalance}</span>
            )}
            <span className="text-xs text-slate-500">
              {formatGDollarNumber(player.g_earned_lifetime)} earned
            </span>
          </div>
        </div>

        {/* Achievement slots */}
        <AchievementSlots walletAddress={player.wallet_address} />

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
          <span>Active {formatTimeAgo(player.last_active)}</span>
          {showShareLink && !isPublic && (
            <button
              onClick={() => navigator.clipboard.writeText(shareUrl)}
              className="flex items-center gap-1 text-valor-gold hover:text-valor-gold-light transition-colors"
            >
              <span>Share card</span>
              <span>↗</span>
            </button>
          )}
          {isPublic && (
            <span className="text-slate-600">valorapp.xyz</span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="bg-valor-surface-2 rounded-lg py-2.5 px-1 text-center border border-valor-border/50">
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="font-bold text-white text-base leading-none">{value}</p>
      <div className="h-0.5 bg-valor-border rounded-full mt-1.5 mx-2 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (value / 30) * 100)}%`, background: color }}
        />
      </div>
    </div>
  )
}
