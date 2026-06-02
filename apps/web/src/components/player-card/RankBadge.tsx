import type { Rank } from '@/types'
import { RANK_COLORS } from '@/lib/constants'

export default function RankBadge({ rank }: { rank: Rank }) {
  const color = RANK_COLORS[rank]
  return (
    <span
      className="text-xs font-bold px-2 py-0.5 rounded-full"
      style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}
    >
      {rank}
    </span>
  )
}
