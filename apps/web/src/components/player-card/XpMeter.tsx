import { motion } from 'framer-motion'
import type { Rank } from '@/types'
import { RANK_COLORS } from '@/lib/constants'

interface Props {
  xp: number
  max: number
  rank: Rank
}

export default function XpMeter({ xp, max, rank }: Props) {
  const pct = Math.min(100, (xp / max) * 100)
  const rankColor = RANK_COLORS[rank]

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 font-medium">XP</span>
        <span className="text-slate-300 font-bold">
          {xp.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-2.5 bg-valor-surface-2 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${rankColor}88, ${rankColor})` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}
