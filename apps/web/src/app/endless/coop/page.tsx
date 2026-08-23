'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Copy, Check, X, Loader2 } from 'lucide-react'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useCoopSocket } from '@/hooks/useCoopSocket'
import LoadingScreen from '@/components/ui/LoadingScreen'

/**
 * Co-op Endless — free, unstaked party lobby. Sits OUTSIDE the `(main)`
 * route group, same as solo Endless (`apps/web/src/app/endless/page.tsx`) —
 * the actual run is a fullscreen `ValorScene`, and that's exactly the class
 * of route Face-Off had a real z-index bug over when it stayed inside
 * `(main)`'s persistent Navbar/MobileNav. Nothing here is on-chain: no
 * stake picker, no signer flow, unlike Duels/Face-Off's lobby.
 *
 * This is Phase 2 of the co-op build (see the plan) — create/join/lobby
 * only. `startRun()` genuinely reaches the server and flips every member to
 * `running`, but nothing consumes that phase yet (no `ValorScene` wiring
 * until Phase 4+), so it's a real signal with a placeholder screen on the
 * other end for now.
 */
export default function CoopLobbyPage() {
  const { status, address } = useResolvedAuth()
  const router = useRouter()
  const player = usePlayerStore((s) => s.player)
  const playerSynced = usePlayerStore((s) => s.playerSynced)
  const coop = useCoopSocket(address ?? '')

  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)

  const displayName = player?.character_name || 'Operator'

  const onCreate = useCallback(() => {
    coop.createParty(displayName)
  }, [coop, displayName])

  const onJoin = useCallback(() => {
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 5) return
    coop.joinParty(code, displayName)
  }, [coop, joinCode, displayName])

  const copyCode = useCallback(() => {
    if (!coop.state.code) return
    navigator.clipboard?.writeText(coop.state.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [coop.state.code])

  if (status === 'loading') return <LoadingScreen />
  if (status === 'unauthenticated' || !address) { router.replace('/'); return null }
  if (!player && !playerSynced) return <LoadingScreen />
  if (!player) { router.replace('/'); return null }

  const { phase, code, members, isHost, error } = coop.state

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto px-5"
      style={{
        background: '#04030c',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)',
      }}
    >
      <div className="max-w-lg mx-auto flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Users className="text-emerald-400" size={22} />
          <div className="flex-1">
            <h1 className="font-display font-black text-white text-xl">Co-op Endless</h1>
            <p className="text-slate-400 text-xs mt-0.5">
              Free — no G$ staked. Fight the same wave together with friends.
            </p>
          </div>
          <button onClick={() => { coop.leaveParty(); router.push('/') }} className="text-slate-500 hover:text-white transition-colors" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {error && (
          <p role="alert" className="text-red-400 text-xs font-medium">{error}</p>
        )}

        {phase === 'idle' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-valor-border bg-valor-surface p-5 flex flex-col gap-3">
              <p className="font-display font-black text-white text-sm uppercase tracking-wider">Start a party</p>
              <p className="text-slate-400 text-xs">You'll get a code to share with friends.</p>
              <button
                onClick={onCreate}
                className="w-full min-h-12 rounded-xl bg-emerald-500 text-black font-bold text-sm hover:bg-emerald-400 transition-colors"
              >
                Create Party
              </button>
            </div>

            <div className="rounded-xl border border-valor-border bg-valor-surface p-5 flex flex-col gap-3">
              <p className="font-display font-black text-white text-sm uppercase tracking-wider">Join a party</p>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 5))}
                placeholder="ENTER CODE"
                maxLength={5}
                className="w-full min-h-12 rounded-xl bg-valor-surface-2 border border-valor-border text-white text-center font-display font-black text-lg tracking-[0.3em] placeholder:text-slate-600 placeholder:tracking-widest focus:outline-none focus:border-emerald-500/50"
              />
              <button
                onClick={onJoin}
                disabled={joinCode.trim().length !== 5}
                className="w-full min-h-12 rounded-xl border border-emerald-500/50 text-emerald-400 font-bold text-sm hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
              >
                Join Party
              </button>
            </div>
          </div>
        )}

        {phase === 'connecting' && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="animate-spin text-emerald-400" size={28} />
            <p className="text-slate-400 text-sm">Connecting…</p>
          </div>
        )}

        {phase === 'lobby' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] p-5 flex flex-col items-center gap-2">
              <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">Party code</p>
              <button onClick={copyCode} className="flex items-center gap-2 font-display font-black text-3xl tracking-[0.3em] text-emerald-400">
                {code}
                {copied ? <Check size={18} /> : <Copy size={18} className="opacity-50" />}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <p className="font-display font-black text-white text-sm uppercase tracking-wider">
                Party ({members.length})
              </p>
              {members.map((m) => (
                <div key={m.wallet} className="rounded-xl border border-valor-border bg-valor-surface-2/50 px-4 py-2.5 flex items-center gap-3">
                  <p className="text-white text-sm truncate flex-1">{m.name || m.wallet}</p>
                  {m.wallet === coop.state.hostWallet && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/30 rounded-sm px-1.5 py-0.5">Host</span>
                  )}
                </div>
              ))}
            </div>

            {isHost ? (
              <button
                onClick={coop.startRun}
                disabled={members.length < 2}
                className="w-full min-h-12 rounded-xl bg-emerald-500 text-black font-bold text-sm hover:bg-emerald-400 transition-colors disabled:opacity-40"
              >
                {members.length < 2 ? 'Waiting for at least one friend…' : 'Start Run'}
              </button>
            ) : (
              <p className="text-slate-400 text-sm text-center py-2">Waiting for the host to start…</p>
            )}
          </div>
        )}

        {phase === 'running' && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="animate-spin text-emerald-400" size={28} />
            <p className="text-slate-400 text-sm">Run starting — arena wiring lands in a later phase.</p>
          </div>
        )}

        {phase === 'ended' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <p className="text-white font-display font-black text-lg">Party ended</p>
            {error && <p className="text-slate-400 text-sm text-center max-w-xs">{error}</p>}
            <button onClick={() => router.push('/endless/coop')} className="px-5 py-2.5 rounded-xl bg-emerald-500 text-black font-bold text-sm">
              Back to lobby
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
