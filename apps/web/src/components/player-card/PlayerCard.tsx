import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import type { Player } from '@/types'
import { RANK_COLORS, XP_PER_RANK } from '@/lib/constants'
import { getDecayStatus } from '@/utils/decay'
import { formatGDollarNumber, formatTimeAgo } from '@/utils/format'
import XpMeter from './XpMeter'
import RankBadge from './RankBadge'
import DecayOverlay from './DecayOverlay'

interface Props {
  player: Player
  isPublic?: boolean
  showShareLink?: boolean
}

export default function PlayerCard({ player, isPublic = false, showShareLink = false }: Props) {
  const decayStatus = getDecayStatus(player.last_active, player.decay_frozen_until)
  const rankColor = RANK_COLORS[player.rank]
  const isDecaying = decayStatus === 'active'

  return (
    <motion.div
      className={`relative rounded-2xl border-2 overflow-hidden ${
        isDecaying ? 'border-red-800/60' : 'border-valor-border'
      } bg-valor-surface`}
      style={
        isDecaying
          ? { filter: 'saturate(0.4) brightness(0.8)' }
          : { boxShadow: `0 0 20px ${rankColor}22` }
      }
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Rank-colored top accent bar */}
      <div className="h-1 w-full" style={{ background: rankColor }} />

      {isDecaying && <DecayOverlay status={decayStatus} />}

      <div className="p-5 flex flex-col gap-4">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2"
            style={{ borderColor: rankColor }}
          >
            {player.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-white truncate">{player.character_name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <RankBadge rank={player.rank} />
              <span className="text-xs text-slate-500 capitalize">{player.play_style}</span>
            </div>
          </div>
        </div>

        {/* XP Meter */}
        <XpMeter xp={player.xp} max={XP_PER_RANK} rank={player.rank} />

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <StatBox label="ATK" value={player.attack_stat} />
          <StatBox label="DEF" value={player.defense_stat} />
          <StatBox label="SPD" value={player.speed_stat} />
        </div>

        {/* Record + Earnings */}
        <div className="flex items-center justify-between text-sm border-t border-valor-border pt-3">
          <span className="text-slate-400">
            <span className="text-green-400 font-bold">{player.wins}W</span>
            {' / '}
            <span className="text-red-400 font-bold">{player.losses}L</span>
          </span>
          <span className="font-bold text-valor-gold">
            {formatGDollarNumber(player.g_earned_lifetime)} earned
          </span>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Active {formatTimeAgo(player.last_active)}</span>
          {showShareLink && !isPublic && (
            <Link
              to={`/card/${player.wallet_address}`}
              className="text-valor-gold hover:text-valor-gold-light"
            >
              Share card →
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-valor-surface-2 rounded-lg py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-bold text-white text-sm">{value}</p>
    </div>
  )
}
