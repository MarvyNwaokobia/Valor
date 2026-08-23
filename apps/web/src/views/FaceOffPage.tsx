'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Crosshair, Coins, Loader2, X, AlertTriangle } from 'lucide-react'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useActiveWalletClientError } from '@/hooks/useActiveWalletClient'
import { useDuels, type DuelRun } from '@/hooks/useDuels'
import { useArenaSocket } from '@/hooks/useArenaSocket'
import { useFaceOffRating } from '@/hooks/useFaceOffRating'
import { retryImport } from '@/lib/retryImport'
import { equippedGunId } from '@/lib/guns'
import LoadingScreen from '@/components/ui/LoadingScreen'
import LoadoutModal from '@/components/battle/LoadoutModal'

const ArenaScene = dynamic(
  () => retryImport(() => import('@/engine/scene/ArenaScene')).then((m) => m.ArenaScene),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-2xl font-black text-white">LOADING ARENA…</div>
      </div>
    ),
  },
)

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`
const who = (name: string | null | undefined, wallet: string | null | undefined) =>
  name || (wallet ? short(wallet) : 'anyone')

function Row({ label, value, gold, strong }: {
  label: string; value: string; gold?: boolean; strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className={`text-sm tabular-nums ${gold ? 'text-valor-gold' : 'text-white'} ${strong ? 'font-bold' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  )
}

/**
 * FACE-OFF — real-time head-to-head PvP duels.
 *
 * Unlike wave_race Duels, there's no async run to submit a score for: once
 * both stakes are in, either player connects to /ws/arena and the server
 * referees the fight live — see arena_server.rs. This page's only jobs are
 * the same staking lobby Duels already has (reused via useDuels with
 * mode:'face_off') plus handing off to that live connection once accepted.
 */
export default function FaceOffPage() {
  const { status, address } = useResolvedAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const player = usePlayerStore((s) => s.player)
  const playerSynced = usePlayerStore((s) => s.playerSynced)
  const inventory = usePlayerStore((s) => s.inventory)
  const equippedGun = useMemo(() => equippedGunId(inventory), [inventory])
  const { duels, loading, pending, signerReady, createDuel, acceptDuel, cancelDuel } = useDuels(address)
  const walletClientError = useActiveWalletClientError()
  const arena = useArenaSocket(address ?? '')
  const { data: rating } = useFaceOffRating(address)

  const challengeWallet = searchParams.get('challenge')
  const challengeName = searchParams.get('name')

  const [stakeChoice, setStakeChoice] = useState(1000)
  const [confirm, setConfirm] = useState<{ mode: 'create' | 'accept'; stake: number; id?: string; invitedWallet?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeDuel, setActiveDuel] = useState<DuelRun | null>(null)
  const [connected, setConnected] = useState(false)
  const [pickingLoadout, setPickingLoadout] = useState(false)
  const [localHp, setLocalHp] = useState(100)
  const [opponentHp, setOpponentHp] = useState(100)
  const [ammo, setAmmo] = useState(30)
  const [reloading, setReloading] = useState(false)

  const enterArena = useCallback(() => {
    if (!activeDuel) return
    setPickingLoadout(false)
    arena.connect(activeDuel.id)
    setConnected(true)
  }, [activeDuel, arena])

  // Face-Off duels only — wave_race rows share the same table/list but have
  // nothing to do with this page.
  const myFaceOff = useMemo(() => duels?.mine.filter((d) => d.mode === 'face_off') ?? [], [duels])
  const openFaceOff = useMemo(() => duels?.open.filter((d) => d.mode === 'face_off') ?? [], [duels])
  const invitedFaceOff = useMemo(() => duels?.invited.filter((d) => d.mode === 'face_off') ?? [], [duels])
  const myOpen = myFaceOff.find((d) => d.status === 'open' && d.challenger.toLowerCase() === address?.toLowerCase())

  // A challenger who created the duel has to wait for someone else to accept
  // it — that shows up here as their row's status flipping to 'accepted' on
  // the next poll (duels.rs also pushes a notification on accept, so this is
  // a fallback, not the only signal). The accepter already knows immediately
  // (acceptDuel's response) and connects directly instead of via this effect.
  useEffect(() => {
    if (!activeDuel || connected || pickingLoadout) return
    const mine = myFaceOff.find((d) => d.id === activeDuel.id)
    if (mine?.status === 'accepted') setPickingLoadout(true)
  }, [activeDuel, connected, pickingLoadout, myFaceOff])

  const onCreate = useCallback(async (amount: number, invitedWallet?: string) => {
    setError(null)
    try {
      const run = await createDuel(amount, invitedWallet, 'face_off')
      setActiveDuel(run)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the duel') }
  }, [createDuel])

  const onAccept = useCallback(async (id: string, stakeG: number) => {
    setError(null)
    try {
      const run = await acceptDuel(id, stakeG)
      setActiveDuel(run)
      setPickingLoadout(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not accept') }
  }, [acceptDuel])

  const backToLobby = useCallback(() => {
    arena.disconnect()
    setConnected(false)
    setPickingLoadout(false)
    setActiveDuel(null)
    setLocalHp(100); setOpponentHp(100); setAmmo(30); setReloading(false)
  }, [arena])

  const onExitMatch = useCallback(() => {
    arena.forfeit()
    backToLobby()
  }, [arena, backToLobby])

  // Re-challenge the same opponent at the same stake — reuses the exact same
  // create-duel flow a fresh challenge does, just pre-filled. Reads the
  // opponent wallet before disconnect() wipes arena.state back to idle.
  const onRematch = useCallback(() => {
    if (!activeDuel || !arena.state.opponent) return
    const stake = activeDuel.stake_g
    const opponentWallet = arena.state.opponent.wallet
    arena.disconnect()
    setConnected(false)
    setPickingLoadout(false)
    setActiveDuel(null)
    setLocalHp(100); setOpponentHp(100); setAmmo(30); setReloading(false)
    void onCreate(stake, opponentWallet)
  }, [activeDuel, arena, onCreate])

  if (status === 'loading') return <LoadingScreen />
  if (status === 'unauthenticated' || !address) { router.replace('/'); return null }
  if (!player && !playerSynced) return <LoadingScreen />
  if (!player) { router.replace('/'); return null }

  // ── Pick a weapon before the fight — same pre-match loadout screen Duels
  // and every Operation use, right before the moment you'd actually deploy.
  // Stakes are already committed by this point (accept/create already
  // happened), so both onDeploy and closing the modal proceed into the
  // arena either way — there's no safe "cancel" once G$ has moved.
  if (pickingLoadout && activeDuel) {
    return (
      <LoadoutModal
        opName="Face-Off"
        label={`Loadout · ${activeDuel.stake_g.toLocaleString()} G$ staked`}
        cta="ENTER THE ARENA"
        walletAddress={address}
        weaponOnly
        onClose={enterArena}
        onDeploy={enterArena}
      />
    )
  }

  // ── The live match itself ────────────────────────────────────────────────
  if (connected && activeDuel && arena.state.phase !== 'idle' && arena.state.phase !== 'result') {
    const opponent = arena.state.opponent
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
        {opponent && (
          <ArenaScene
            walletAddress={address}
            opponentWallet={opponent.wallet}
            fighting={arena.state.phase === 'fighting'}
            sendInput={arena.sendInput}
            drainHits={arena.drainHits}
            latestPlayers={arena.latestPlayers}
            onLocalHp={setLocalHp}
            onAmmo={(a, r) => { setAmmo(a); setReloading(r) }}
            onOpponentHp={setOpponentHp}
            equippedGun={equippedGun}
          />
        )}
        <FaceOffHud
          phase={arena.state.phase}
          pause={arena.state.pause}
          countdown={arena.state.countdown}
          opponentName={opponent ? who(null, opponent.wallet) : '…'}
          localHp={localHp} opponentHp={opponentHp}
          ammo={ammo} reloading={reloading}
          onExit={onExitMatch}
        />
      </div>
    )
  }

  // Connection dropped or the opponent left before a real result — surface it
  // distinctly rather than pretending the lobby never staked anything.
  if (connected && arena.state.error && arena.state.phase === 'idle') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#04030c' }}>
        <AlertTriangle className="text-amber-400" size={32} />
        <p className="font-display font-black text-white text-lg">{arena.state.error}</p>
        <p className="text-slate-400 text-sm max-w-xs">
          If your opponent disconnected mid-fight, check your duel history — this can take a moment to settle.
        </p>
        <button onClick={backToLobby} className="mt-2 px-5 py-2.5 rounded-xl bg-valor-gold text-black font-bold text-sm">
          Back to Face-Off
        </button>
      </div>
    )
  }

  if (connected && arena.state.phase === 'result' && arena.state.result) {
    const r = arena.state.result
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: '#04030c' }}>
        <p className={`font-display font-black text-2xl ${r.result === 'win' ? 'text-valor-gold' : 'text-white'}`}>
          {r.result === 'win' ? 'You won' : r.result === 'draw' ? 'Draw' : 'You lost'}
        </p>
        <p className="text-slate-400 text-sm">
          {r.reason === 'forfeit'
            ? (r.result === 'win' ? 'Your opponent left the match.' : 'You left the match.')
            : r.reason === 'disconnect_timeout'
            ? (r.result === 'win' ? "Your opponent didn't reconnect in time." : "You didn't reconnect in time.")
            : r.reason === 'timeout' ? 'Decided on time — higher HP took it.' : 'Decided by elimination.'}
        </p>
        <div className="mt-2 flex gap-2">
          {arena.state.opponent && (
            <button onClick={onRematch} disabled={pending}
              className="px-5 py-2.5 rounded-xl border border-valor-gold/50 text-valor-gold font-bold text-sm hover:bg-valor-gold/10 transition-colors disabled:opacity-40"
            >
              Rematch
            </button>
          )}
          <button onClick={backToLobby} className="px-5 py-2.5 rounded-xl bg-valor-gold text-black font-bold text-sm">
            Back to Face-Off
          </button>
        </div>
      </div>
    )
  }

  if (duels && (!Array.isArray(duels.stake_tiers) || typeof duels.house_cut_bps !== 'number')) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: '#04030c' }}>
        <p className="font-display font-black text-white text-lg">Face-Off is updating</p>
        <p className="text-slate-400 text-sm max-w-xs">The server is mid-deploy. Check back in a minute — nothing has been staked.</p>
        <button onClick={() => router.push('/')} className="mt-2 text-xs text-slate-500 hover:text-white transition-colors">Back</button>
      </div>
    )
  }

  const tiers = duels?.stake_tiers ?? []
  const cutBps = duels?.house_cut_bps ?? 50
  const cutLabel = `${(cutBps / 100).toFixed(cutBps % 100 === 0 ? 0 : 1)}%`
  const payoutFor = (s: number) => Math.floor((s * 2 * (10_000 - cutBps)) / 10_000)
  const poolCut = (s: number) => s * 2 - payoutFor(s)
  const currency = 'G$'
  const activeStake = tiers.includes(stakeChoice) ? stakeChoice : (tiers[Math.floor(tiers.length / 2)] ?? stakeChoice)

  // Waiting on an opponent to accept our own open challenge.
  if (activeDuel && myOpen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: '#04030c' }}>
        <Loader2 className="animate-spin text-valor-gold" size={28} />
        <p className="font-display font-black text-white text-lg">Waiting for an opponent</p>
        <p className="text-slate-400 text-sm max-w-xs">
          {myOpen.stake_g.toLocaleString()} {currency} staked. You&apos;ll drop straight into the arena the moment someone accepts.
        </p>
        <button
          onClick={() => { setError(null); void cancelDuel(myOpen.id).then(() => setActiveDuel(null)).catch((e) => setError(e.message)) }}
          disabled={pending}
          className="mt-2 text-xs text-slate-500 hover:text-red-300 transition-colors"
        >
          {pending ? 'Closing…' : 'Cancel & refund my stake'}
        </button>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    )
  }

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
          <Crosshair className="text-red-400" size={22} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-black text-white text-xl">Face-Off</h1>
              {rating !== undefined && (
                <span className="text-[10px] font-bold text-slate-400 px-1.5 py-0.5 rounded-sm border border-valor-border" title="Face-Off rating — tracked, doesn't affect matchmaking or stakes">
                  {rating} ELO
                </span>
              )}
            </div>
            <p className="text-slate-400 text-xs mt-0.5">
              Live, head-to-head. Same standard-issue rifle for both fighters — winner takes the pot.
            </p>
          </div>
          <button onClick={() => router.push('/')} className="text-slate-500 hover:text-white transition-colors" aria-label="Close face-off">
            <X size={20} />
          </button>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              role="alert" className="text-red-400 text-xs font-medium">{error}</motion.p>
          )}
        </AnimatePresence>

        {!signerReady && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3 flex flex-col gap-1">
            <p className="text-amber-300 text-sm font-bold">Wallet session not ready</p>
            <p className="text-slate-400 text-xs leading-relaxed">
              You&apos;re signed in, but your wallet can&apos;t sign right now — so staking is paused.
              This usually clears on reload; if it doesn&apos;t, sign out and back in.
            </p>
            {walletClientError && (
              <p className="text-amber-500/60 text-[10px] font-mono wrap-break-word mt-1">{walletClientError.message}</p>
            )}
          </div>
        )}

        {!confirm && (
          <div className="rounded-xl border border-valor-border bg-valor-surface p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="font-display font-black text-white text-sm uppercase tracking-wider">
                {challengeWallet ? `Challenge ${challengeName || 'friend'}` : 'Open a challenge'}
              </p>
              {challengeWallet && (
                <button onClick={() => router.push('/faceoff')} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                  Open to anyone instead
                </button>
              )}
            </div>
            <p className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">
              {challengeWallet ? 'Only they can accept this stake' : 'Choose your stake'}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {tiers.map((t) => (
                <button
                  key={t}
                  onClick={() => setStakeChoice(t)}
                  aria-pressed={activeStake === t}
                  className={`min-h-12 rounded-xl border font-bold text-sm transition-colors ${
                    activeStake === t
                      ? 'border-valor-gold bg-valor-gold/15 text-valor-gold'
                      : 'border-valor-border bg-valor-surface-2 text-slate-300 hover:border-valor-gold/50'
                  }`}
                >
                  {t.toLocaleString()}
                </button>
              ))}
            </div>
            <button
              onClick={() => setConfirm({ mode: 'create', stake: activeStake, invitedWallet: challengeWallet ?? undefined })}
              disabled={pending || !signerReady}
              className="w-full min-h-12 rounded-xl bg-valor-gold text-black font-bold text-sm hover:bg-valor-gold-light transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Coins size={16} /> Review stake
            </button>
          </div>
        )}

        {confirm && (
          <div className="rounded-xl border border-valor-gold/50 bg-valor-surface p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-valor-gold shrink-0" size={16} />
              <p className="font-display font-black text-white text-sm uppercase tracking-wider">You are staking real {currency}</p>
            </div>

            <div className="rounded-xl bg-valor-surface-2 border border-valor-border divide-y divide-valor-border">
              <Row label="Your stake" value={`${confirm.stake.toLocaleString()} ${currency}`} strong />
              <Row label="Opponent stakes" value={`${confirm.stake.toLocaleString()} ${currency}`} />
              <Row label="If you win" value={`+${payoutFor(confirm.stake).toLocaleString()} ${currency}`} gold strong />
              <Row label="If you lose" value={`-${confirm.stake.toLocaleString()} ${currency}`} />
              <Row label={`Valor pool (${cutLabel})`} value={`${poolCut(confirm.stake).toLocaleString()} ${currency}`} />
            </div>

            <p className="text-slate-500 text-xs leading-relaxed">
              Your stake leaves your wallet now and is held until the fight ends. First to eliminate the
              other wins the pot; if time runs out, higher HP wins. An exact tie refunds both stakes.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setConfirm(null)} disabled={pending}
                className="flex-1 min-h-12 rounded-xl border border-valor-border bg-valor-surface-2 text-slate-300 font-bold text-sm hover:text-white transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const c = confirm
                  setConfirm(null)
                  if (c.mode === 'create') void onCreate(c.stake, c.invitedWallet)
                  else void onAccept(c.id!, c.stake)
                }}
                disabled={pending}
                className="flex-1 min-h-12 rounded-xl bg-valor-gold text-black font-bold text-sm hover:bg-valor-gold-light transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {pending ? <><Loader2 className="animate-spin" size={16} /> Staking…</> : <>Stake {confirm.stake.toLocaleString()} {currency}</>}
              </button>
            </div>
          </div>
        )}

        {invitedFaceOff.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="font-display font-black text-white text-sm uppercase tracking-wider">Challenges for you</p>
            {invitedFaceOff.map((d) => (
              <div key={d.id} className="rounded-xl border border-valor-gold/40 bg-valor-gold/[0.06] px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm truncate">{who(d.challenger_name, d.challenger)}</p>
                  <p className="text-slate-500 text-[11px]">{d.stake_g.toLocaleString()} {currency} · winner takes {d.winner_takes_g.toLocaleString()}</p>
                </div>
                <button
                  onClick={() => setConfirm({ mode: 'accept', stake: d.stake_g, id: d.id })}
                  disabled={pending || !signerReady}
                  className="shrink-0 px-4 min-h-10 rounded-lg bg-valor-gold text-black font-bold text-xs hover:bg-valor-gold-light transition-colors disabled:opacity-40"
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="font-display font-black text-white text-sm uppercase tracking-wider">Open challenges</p>
          {loading && <p className="text-slate-500 text-sm">Loading…</p>}
          {!loading && openFaceOff.filter((d) => d.challenger.toLowerCase() !== address.toLowerCase()).length === 0 && (
            <p className="text-slate-500 text-sm">Nobody has an open challenge. Open one and wait for a taker.</p>
          )}
          {openFaceOff
            .filter((d) => d.challenger.toLowerCase() !== address.toLowerCase())
            .map((d) => (
              <div key={d.id} className="rounded-xl border border-valor-border bg-valor-surface-2/50 px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm truncate">{who(d.challenger_name, d.challenger)}</p>
                  <p className="text-slate-500 text-[11px]">{d.stake_g.toLocaleString()} {currency} · winner takes {d.winner_takes_g.toLocaleString()}</p>
                </div>
                <button
                  onClick={() => setConfirm({ mode: 'accept', stake: d.stake_g, id: d.id })}
                  disabled={pending || !signerReady}
                  className="shrink-0 px-4 min-h-10 rounded-lg bg-valor-gold text-black font-bold text-xs hover:bg-valor-gold-light transition-colors disabled:opacity-40"
                >
                  Accept
                </button>
              </div>
            ))}
        </div>

        {myFaceOff.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="font-display font-black text-white text-sm uppercase tracking-wider">Your face-offs</p>
            {myFaceOff.map((d) => {
              const won = d.status === 'resolved' && d.winner?.toLowerCase() === address.toLowerCase()
              const drew = d.status === 'resolved' && !d.winner
              return (
                <div key={d.id} className="rounded-xl border border-valor-border bg-valor-surface-2/50 px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300 text-sm truncate">
                      vs {who(d.opponent_name, d.opponent)} · {d.stake_g.toLocaleString()} {currency}
                    </p>
                  </div>
                  {d.status === 'accepted' && (
                    <button
                      onClick={() => router.push(`/faceoff/watch/${d.id}`)}
                      className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/10 transition-colors"
                    >
                      Watch
                    </button>
                  )}
                  <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wider ${
                    won ? 'text-valor-gold' : drew ? 'text-slate-400' : d.status === 'resolved' ? 'text-slate-500' : 'text-slate-400'
                  }`}>
                    {d.status === 'resolved' ? (won ? 'Won' : drew ? 'Draw' : 'Lost') : d.status}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── In-match HUD ──────────────────────────────────────────────────────────

function FaceOffHud({ phase, pause, countdown, opponentName, localHp, opponentHp, ammo, reloading, onExit }: {
  phase: 'idle' | 'connecting' | 'waiting' | 'countdown' | 'fighting' | 'result'
  pause: { reason: 'opponent_disconnected' | 'reconnecting'; graceSeconds: number } | null
  countdown: number
  opponentName: string
  localHp: number
  opponentHp: number
  ammo: number
  reloading: boolean
  onExit: () => void
}) {
  const [confirmExit, setConfirmExit] = useState(false)
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: 'var(--font-display, sans-serif)', color: '#e9edf2' }}>
      {/* Exit — a deliberate quit, not just closing the tab. Real G$ is
          staked, so this always confirms before forfeiting it. */}
      <button
        onClick={() => setConfirmExit(true)}
        style={{
          position: 'absolute', left: 16, top: 'calc(env(safe-area-inset-top, 0px) + 16px)', pointerEvents: 'auto',
          padding: '6px 12px', borderRadius: 8, background: 'rgba(4,3,12,0.6)', border: '1px solid rgba(255,255,255,0.18)',
          color: '#cbd5e1', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
        }}
      >
        Exit
      </button>
      {confirmExit && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,3,12,0.88)', padding: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', maxWidth: 280 }}>
            <p className="font-display font-black text-white text-lg">Exit the fight?</p>
            <p className="text-slate-400 text-sm">
              You forfeit your stake — {opponentName} wins the pot. This can&apos;t be undone.
            </p>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <button
                onClick={() => setConfirmExit(false)}
                style={{ flex: 1, minHeight: 44, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', fontWeight: 700, fontSize: 13 }}
              >
                Keep fighting
              </button>
              <button
                onClick={onExit}
                style={{ flex: 1, minHeight: 44, borderRadius: 10, border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.18)', color: '#fca5a5', fontWeight: 700, fontSize: 13 }}
              >
                Exit & forfeit
              </button>
            </div>
          </div>
        </div>
      )}
      {(phase === 'connecting' || phase === 'waiting') && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,3,12,0.85)' }}>
          <p className="text-white font-display font-black text-lg">
            {phase === 'connecting' ? 'Connecting…' : `Waiting for ${opponentName}…`}
          </p>
        </div>
      )}
      {phase === 'countdown' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,3,12,0.6)' }}>
          <p className="text-valor-gold font-display font-black text-6xl">{countdown}</p>
        </div>
      )}
      {/* The match is frozen, not over — arena_server.rs pauses HP/position
          on either side dropping and gives them a window to reconnect into
          this same fight before it settles as a forfeit. */}
      {pause && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', background: 'rgba(4,3,12,0.85)', textAlign: 'center', padding: 24 }}>
          <p className="text-white font-display font-black text-lg">
            {pause.reason === 'reconnecting' ? 'Reconnecting…' : `${opponentName} disconnected`}
          </p>
          <p className="text-slate-400 text-sm max-w-xs">
            {pause.reason === 'reconnecting'
              ? "Your connection dropped — trying to get you back into the fight. Nothing is lost yet."
              : `Waiting up to ${pause.graceSeconds}s for them to reconnect. If they don't, you win by forfeit.`}
          </p>
        </div>
      )}
      {phase === 'fighting' && (
        <>
          <div style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <p className="text-white text-xs font-bold uppercase tracking-wider">You</p>
            <HpBar hp={localHp} color="#22c55e" />
            <p className="text-slate-400 text-[11px] mt-1">
              {ammo} {reloading && <span className="text-amber-400">· reloading</span>}
            </p>
          </div>
          <div style={{ position: 'absolute', right: 16, top: 16, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <p className="text-white text-xs font-bold uppercase tracking-wider">{opponentName}</p>
            <HpBar hp={opponentHp} color="#ef4444" />
          </div>
        </>
      )}
    </div>
  )
}

function HpBar({ hp, color }: { hp: number; color: string }) {
  return (
    <div style={{ width: 140, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, hp))}%`, height: '100%', background: color, transition: 'width 120ms linear' }} />
    </div>
  )
}
