'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useGroup } from '@/hooks/useGroups'
import { useSeasonalRun } from '@/hooks/useSeasonalRun'
import WaveBoard from '@/components/battle/WaveBoard'

const GOLD = '#eab308'

function status(s: { upcoming: boolean; ended: boolean; ends_at: string | null; starts_at: string }): string {
  const left = (iso: string) => {
    const ms = new Date(iso).getTime() - Date.now()
    if (ms <= 0) return 'now'
    const d = Math.floor(ms / 86_400_000)
    const h = Math.floor((ms % 86_400_000) / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  }
  if (s.upcoming) return `Opens in ${left(s.starts_at)}`
  if (s.ended) return 'Season closed, payouts settling'
  return s.ends_at ? `Live, closes in ${left(s.ends_at)}` : 'Live now'
}

/** A group's public leaderboard for the current season. No sign-in needed to look. */
export default function GroupBoardPage() {
  const { slug: raw } = useParams<{ slug: string }>()
  const slug = (raw ?? '').toLowerCase()
  const { address } = useResolvedAuth()
  const group = useGroup(slug)
  const { season } = useSeasonalRun(undefined)

  if (group.isLoading) return <div className="p-8 text-center text-slate-500">Loading…</div>
  if (!group.data) {
    return <div className="p-8 text-center text-slate-500">Group not found.</div>
  }

  const g = group.data
  const prizeHere = season && (!season.payout_group || season.payout_group.slug === slug)

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[380px]"
           style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(234,179,8,0.14), transparent 70%)' }} />
      <div className="relative max-w-md mx-auto px-5 pt-10 pb-12">
        <div className="text-center mb-7">
          <div className="flex items-center justify-center gap-2 mb-6">
            <img src="/valor-mark.png" alt="" width={26} height={26} className="opacity-90" />
            <span className="font-display font-black tracking-[0.3em] text-sm text-amber-400">VALOR</span>
          </div>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500 mb-2">Group leaderboard</p>
          <h1 className="font-display font-black text-white leading-none" style={{ fontSize: 'clamp(2.75rem, 15vw, 4rem)' }}>{g.name}</h1>
          {g.members >= 5 && <p className="text-slate-500 text-xs mt-2">{g.members} players</p>}
        </div>

        {season && (
          <div className="mb-7 rounded-2xl px-5 py-4 text-center"
               style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.3)' }}>
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-amber-500/80 mb-1">{season.name}</p>
            {prizeHere && (
              <p className="font-display font-black text-amber-400 text-3xl">{season.prize_pool_g.toLocaleString()} G$</p>
            )}
            <p className="text-slate-400 text-xs mt-1">
              {prizeHere ? 'Top 3 split the prize pool · ' : ''}{status(season)}
            </p>
            <p className="text-slate-600 text-[11px] mt-1">Ranked by waves completed. Ties go to whoever got there first.</p>
          </div>
        )}

        <WaveBoard groupSlug={slug} highlightWallet={address} limit={100} podium title={`${g.name} · Season`} />

        <div className="mt-8 grid grid-cols-2 gap-3">
          <Link href="/seasonal" className="text-center px-4 py-3.5 rounded-xl font-display font-black text-black" style={{ background: GOLD }}>
            Play the Season
          </Link>
          <Link href={`/join/${slug}`} className="text-center px-4 py-3.5 rounded-xl font-bold text-white border border-slate-700">
            Join {g.name}
          </Link>
        </div>
      </div>
    </div>
  )
}
