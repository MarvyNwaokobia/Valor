'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useGroup, useMyGroup, rememberPendingGroup, clearPendingGroup } from '@/hooks/useGroups'
import SignInModal from '@/components/ui/SignInModal'

export default function JoinGroupPage() {
  const { slug: rawSlug } = useParams<{ slug: string }>()
  const slug = (rawSlug ?? '').toLowerCase()
  const { status, address } = useResolvedAuth()
  const player = usePlayerStore((s) => s.player)
  const group = useGroup(slug)
  const mine = useMyGroup(address)
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

  return (
    <div className="max-w-md mx-auto px-4 py-12 text-center">
      <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500 mb-3">You are invited to represent</p>
      <h1 className="font-display font-black text-4xl text-white mb-2">{g.name}</h1>
      {g.description && <p className="text-slate-400 text-sm mb-2">{g.description}</p>}
      <p className="text-slate-500 text-xs mb-8">{g.members} {g.members === 1 ? 'player' : 'players'} in this group</p>

      {!player && (
        <div className="text-left rounded-xl px-4 py-3 mb-6"
             style={{ background: 'rgba(8,8,14,0.9)', border: '1px solid rgba(42,42,58,0.8)' }}>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-amber-400 mb-1.5">Before you can play</p>
          <p className="text-slate-300 text-sm leading-relaxed">
            Valor needs every player to be <b>GoodDollar verified</b>, a quick face check that proves you are one real person.
            It takes a few minutes, so do it <b>before the event</b>, not when the games start.
            You will be asked to verify right after you sign in.
          </p>
        </div>
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

      <Link href={`/groups/${slug}`} className="block text-xs text-slate-500 hover:text-slate-300 mt-6">See the {g.name} leaderboard</Link>

      {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
      {signIn && <SignInModal onClose={() => setSignIn(false)} />}
    </div>
  )
}
