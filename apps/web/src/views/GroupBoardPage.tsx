'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useGroup } from '@/hooks/useGroups'
import WaveBoard from '@/components/battle/WaveBoard'

/** A group's public leaderboard for the current season. No sign-in needed to look. */
export default function GroupBoardPage() {
  const { slug: raw } = useParams<{ slug: string }>()
  const slug = (raw ?? '').toLowerCase()
  const { address } = useResolvedAuth()
  const group = useGroup(slug)

  if (group.isLoading) return <div className="p-8 text-center text-slate-500">Loading…</div>
  if (!group.data) {
    return <div className="p-8 text-center text-slate-500">Group not found.</div>
  }

  return (
    <div className="max-w-md mx-auto py-8">
      <div className="text-center mb-8">
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500 mb-2">Group leaderboard</p>
        <h1 className="font-display font-black text-4xl text-white">{group.data.name}</h1>
        <p className="text-slate-500 text-xs mt-1">
          {group.data.members} {group.data.members === 1 ? 'player' : 'players'} · ranked by waves completed this season
        </p>
      </div>

      <WaveBoard groupSlug={slug} highlightWallet={address} limit={100} title={`${group.data.name} · Season`} />

      <div className="mt-8 grid grid-cols-2 gap-3">
        <Link href="/seasonal" className="text-center px-4 py-3 rounded-xl font-display font-black text-black" style={{ background: '#eab308' }}>
          Play the Season
        </Link>
        <Link href={`/join/${slug}`} className="text-center px-4 py-3 rounded-xl font-bold text-white border border-slate-700">
          Join {group.data.name}
        </Link>
      </div>
    </div>
  )
}
