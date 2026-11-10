'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useMyGroup } from '@/hooks/useGroups'
import { useSeasonalRun } from '@/hooks/useSeasonalRun'

/**
 * A quiet row on Home for a player who is not in any group while a season pays one
 * group only. Covers the student who dismissed the invite, or signed up on a device
 * that never saw the join link. It points at the join page, which does the joining.
 */
export default function JoinGroupRow() {
  const { address } = useResolvedAuth()
  const mine = useMyGroup(address)
  const { season } = useSeasonalRun(undefined)

  const target = season?.payout_group
  if (!target || season.ended || mine.loading || mine.group) return null

  return (
    <Link
      href={`/join/${target.slug}`}
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-colors hover:border-amber-500/60"
      style={{ background: 'rgba(234,179,8,0.07)', borderColor: 'rgba(234,179,8,0.3)' }}
    >
      <div className="min-w-0">
        <p className="font-bold text-white text-sm">Join {target.name}</p>
        <p className="text-[11px] text-slate-400 truncate">
          {season.prize_pool_g.toLocaleString()} G$ prize pool, {target.name} players only
        </p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-amber-400" />
    </Link>
  )
}
