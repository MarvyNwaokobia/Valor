'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useGroup, useMyGroup, rememberPendingGroup, clearPendingGroup } from '@/hooks/useGroups'
import SignInModal from '@/components/ui/SignInModal'
import { useSeasonalRun } from '@/hooks/useSeasonalRun'

const GOLD = '#eab308'

function dayRange(startIso: string, endIso: string | null): string {
  const f = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })
  return endIso ? `${f(startIso)} to ${f(endIso)}` : `from ${f(startIso)}`
}

export default function JoinGroupPage() {
  const { slug: rawSlug } = useParams<{ slug: string }>()
  const slug = (rawSlug ?? '').toLowerCase()
  const { status, address } = useResolvedAuth()
  const player = usePlayerStore((s) => s.player)
  const group = useGroup(slug)
  const mine = useMyGroup(address)
  const { season } = useSeasonalRun(undefined)
  const [signIn, setSignIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Park the link so it survives sign-in and onboarding.
  useEffect(() => { if (slug) rememberPendingGroup(slug) }, [slug])

  const g = group.data
  const signedIn = status === 'ready' && !!address
  const inThis = mine.group?.slug === slug
  const inOther = !!mine.group && !inThis

  async function onJoin() {
    setBusy(true); setError(null)
    try {
      await mine.join(slug)
      clearPendingGroup()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join')
    } finally {
      setBusy(false)
    }
  }

  if (group.isLoading) return <div className="p-8 text-center text-slate-500">Loading…</div>

  if (!g) {
    return (
      <div className="max-w-md mx-auto p-8 text-center">
        <h1 className="font-display font-black text-2xl text-white mb-2">Group not found</h1>
        <p className="text-slate-500 text-sm">This link does not match a Valor group. Check it with whoever sent it.</p>
      </div>
    )
  }

  const prizeForGroup = season && (!season.payout_group || season.payout_group.slug === slug)
  const steps = [
    { n: '1', t: 'Sign in', d: 'Email, Google or your wallet.' },
    { n: '2', t: 'Verify with GoodDollar', d: 'A quick face check, a few minutes. Do it before the event.' },
    { n: '3', t: `Join ${g.name} and play`, d: 'Climb the board. Top 3 split the prize.' },
  ]

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
           style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(234,179,8,0.16), transparent 70%)' }} />
      <div className="relative max-w-md mx-auto px-5 pt-10 pb-12 text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <img src="/valor-mark.png" alt="" width={28} height={28} className="opacity-90" />
          <span className="font-display font-black tracking-[0.3em] text-sm text-amber-400">VALOR</span>
        </div>

        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500 mb-3">You are invited to represent</p>
        <h1 className="font-display font-black text-white leading-none mb-3" style={{ fontSize: 'clamp(3rem, 16vw, 4.5rem)' }}>{g.name}</h1>
        {g.description && <p className="text-slate-400 text-sm mb-1">{g.description}</p>}
        {g.members >= 5 && <p className="text-slate-500 text-xs">{g.members} players have joined</p>}

        {season && prizeForGroup && !season.ended && (
          <div className="mt-7 rounded-2xl px-5 py-4"
               style={{ background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.3)' }}>
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-amber-500/80 mb-1">Prize pool</p>
            <p className="font-display font-black text-amber-400 text-3xl">{season.prize_pool_g.toLocaleString()} G$</p>
            <p className="text-slate-400 text-xs mt-1">
              {season.name} · {dayRange(season.starts_at, season.ends_at)}
              {season.payout_group ? ` · paid to ${season.payout_group.name} players only` : ''}
            </p>
          </div>
        )}

        {!player && (
          <ol className="text-left mt-7 mb-7 space-y-3">
            {steps.map((st) => (
              <li key={st.n} className="flex gap-3 items-start">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black text-black" style={{ background: GOLD }}>{st.n}</span>
                <div>
                  <p className="text-white text-sm font-bold leading-tight">{st.t}</p>
                  <p className="text-slate-500 text-xs leading-snug mt-0.5">{st.d}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

      {!signedIn ? (
        <button
          onClick={() => setSignIn(true)}
          className="w-full px-6 py-4 rounded-xl font-display font-black text-black"
          style={{ background: '#eab308' }}
        >
          Sign in to join {g.name}
        </button>
      ) : !player ? (
        <>
          <p className="text-slate-400 text-sm mb-4">Create your fighter first. Your invite is saved, and you will be asked to join {g.name} when you are done.</p>
          <Link
            href="/onboarding"
            className="block w-full px-6 py-4 rounded-xl font-display font-black text-black"
            style={{ background: '#eab308' }}
          >
            Create your fighter
          </Link>
        </>
      ) : inThis ? (
        <>
          <p className="text-emerald-400 font-bold mb-4">You are representing {g.name}.</p>
          <Link href="/seasonal" className="block w-full px-6 py-4 rounded-xl font-display font-black text-black" style={{ background: '#eab308' }}>
            Play the Season
          </Link>
        </>
      ) : inOther ? (
        <p className="text-slate-400 text-sm">You are already in <b className="text-white">{mine.group?.name}</b>. Leave it from your profile to join {g.name}.</p>
      ) : (
        <button
          onClick={onJoin}
          disabled={busy || mine.loading}
          className="w-full px-6 py-4 rounded-xl font-display font-black text-black disabled:opacity-40"
          style={{ background: '#eab308' }}
        >
          {busy ? 'Joining…' : `Join ${g.name}`}
        </button>
      )}

        <Link href={`/groups/${slug}`} className="block text-xs text-slate-500 hover:text-slate-300 mt-6 py-2">See the {g.name} leaderboard</Link>

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
        {signIn && <SignInModal onClose={() => setSignIn(false)} />}
      </div>
    </div>
  )
}
