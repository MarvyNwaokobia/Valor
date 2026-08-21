'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, UserPlus, UserMinus, Swords, Check, X, Loader2 } from 'lucide-react'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useFriends, type FriendEntry, type FriendRequestEntry } from '@/hooks/useFriends'
import LoadingScreen from '@/components/ui/LoadingScreen'

const who = (f: { username: string | null; character_name: string }) => f.username || f.character_name

type Tab = 'friends' | 'requests'

/**
 * FRIENDS — opt-in social graph, kept separate from referrals.
 *
 * A referral pays out once for bringing in a new verified player; it has never
 * meant "we're friends", so nothing here is auto-populated from it. Every
 * relationship is a request the other person chooses to accept.
 */
export default function FriendsPage() {
  const { status, address } = useResolvedAuth()
  const router = useRouter()
  const player = usePlayerStore((s) => s.player)
  const { friends, incoming, outgoing, loading, error, sendRequest, acceptRequest, removeFriend } =
    useFriends(address)

  const [tab, setTab] = useState<Tab>('friends')
  const [addBy, setAddBy] = useState<'username' | 'character' | 'wallet'>('username')
  const [identifier, setIdentifier] = useState('')
  const [sending, setSending] = useState(false)
  const [busyWallet, setBusyWallet] = useState<string | null>(null)
  // Wallet awaiting an explicit "yes, remove them" — unfriending is a one-way
  // action (they'd have to re-request), so a stray tap on the button that
  // starts it must not be enough to finish it.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)

  if (status === 'loading') return <LoadingScreen />
  if (status === 'unauthenticated' || !address) { router.replace('/'); return null }
  if (!player) { router.replace('/'); return null }

  const onAdd = async () => {
    const value = identifier.trim()
    if (!value) return
    setFormError(null)
    setFormNotice(null)
    setSending(true)
    try {
      const result = await sendRequest(value)
      setIdentifier('')
      setFormNotice(result.auto_accepted ? 'You are now friends' : 'Friend request sent')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not send request')
    } finally {
      setSending(false)
    }
  }

  const withBusy = async (wallet: string, fn: () => Promise<void>) => {
    setBusyWallet(wallet)
    setFormError(null)
    try { await fn() }
    catch (e) { setFormError(e instanceof Error ? e.message : 'Something went wrong') }
    finally { setBusyWallet(null) }
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
          <Users className="text-valor-gold" size={22} />
          <div className="flex-1">
            <h1 className="font-display font-black text-white text-xl">Friends</h1>
            <p className="text-slate-400 text-xs mt-0.5">
              Add fighters, then challenge them straight to a duel.
            </p>
          </div>
          <button onClick={() => router.push('/profile')} className="text-slate-500 hover:text-white transition-colors" aria-label="Close friends">
            <X size={20} />
          </button>
        </div>

        {/* ── Add a friend ─────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-valor-border bg-valor-surface p-5 flex flex-col gap-3">
          <p className="font-display font-black text-white text-sm uppercase tracking-wider">Add a friend</p>

          {/* The player picks which they're typing — the server tries all three
              regardless (wallet, then username, then character name), so this
              toggle only steers the placeholder/label toward what they chose. */}
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'username' as const, label: 'Username' },
              { id: 'character' as const, label: 'Char. name' },
              { id: 'wallet' as const, label: 'Wallet' },
            ]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setAddBy(id)}
                aria-pressed={addBy === id}
                className={`min-h-10 rounded-lg border font-bold text-xs uppercase tracking-wider transition-colors ${
                  addBy === id
                    ? 'border-valor-gold bg-valor-gold/15 text-valor-gold'
                    : 'border-valor-border bg-valor-surface-2 text-slate-300 hover:border-valor-gold/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onAdd() }}
              placeholder={addBy === 'username' ? 'Username' : addBy === 'character' ? 'Character name' : '0x…'}
              className="flex-1 min-h-11 rounded-lg border border-valor-border bg-valor-surface-2 px-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-valor-gold/50"
            />
            <button
              onClick={() => void onAdd()}
              disabled={sending || !identifier.trim()}
              className="shrink-0 min-h-11 px-4 rounded-lg bg-valor-gold text-black font-bold text-xs hover:bg-valor-gold-light transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              {sending ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
              Add
            </button>
          </div>

          {formNotice && <p className="text-green-400 text-xs font-medium">{formNotice}</p>}
        </div>

        <AnimatePresence>
          {(error || formError) && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              role="alert" className="text-red-400 text-xs font-medium">{formError ?? error}</motion.p>
          )}
        </AnimatePresence>

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div className="flex gap-2 border-b border-valor-border">
          {([
            { id: 'friends' as const, label: `Friends (${friends.length})` },
            { id: 'requests' as const, label: `Requests (${incoming.length})` },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 pb-2.5 text-xs font-black uppercase tracking-wider transition-colors relative ${
                tab === t.id ? 'text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 inset-x-0 h-0.5 rounded-full bg-valor-gold" />
              )}
            </button>
          ))}
        </div>

        {loading && <p className="text-slate-500 text-sm">Loading…</p>}

        {/* ── Friends list ──────────────────────────────────────────────────── */}
        {tab === 'friends' && !loading && (
          <div className="flex flex-col gap-2">
            {friends.length === 0 && (
              <p className="text-slate-500 text-sm">No friends yet — add one above.</p>
            )}
            {friends.map((f: FriendEntry) => (
              <div key={f.wallet} className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors ${
                confirmRemove === f.wallet ? 'border-red-500/50 bg-red-500/[0.06]' : 'border-valor-border bg-valor-surface-2/50'
              }`}>
                {confirmRemove === f.wallet ? (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm truncate">Remove {who(f)}?</p>
                      <p className="text-slate-500 text-[11px]">They&apos;ll need to send a new request to be friends again.</p>
                    </div>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      disabled={busyWallet === f.wallet}
                      className="shrink-0 px-3 min-h-9 rounded-lg border border-valor-border bg-valor-surface-2 text-slate-300 font-bold text-xs hover:text-white transition-colors disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void withBusy(f.wallet, () => removeFriend(f.wallet)).then(() => setConfirmRemove(null))}
                      disabled={busyWallet === f.wallet}
                      className="shrink-0 px-3 min-h-9 rounded-lg bg-red-500/90 text-white font-bold text-xs hover:bg-red-500 transition-colors disabled:opacity-40 flex items-center gap-1.5"
                    >
                      {busyWallet === f.wallet ? <Loader2 className="animate-spin" size={13} /> : <UserMinus size={13} />}
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm truncate">{who(f)}</p>
                      <p className="text-slate-500 text-[11px] uppercase tracking-wider">{f.rank}</p>
                    </div>
                    <button
                      onClick={() => router.push(`/duels?challenge=${f.wallet}&name=${encodeURIComponent(who(f))}`)}
                      className="shrink-0 px-3 min-h-9 rounded-lg bg-valor-gold text-black font-bold text-xs hover:bg-valor-gold-light transition-colors flex items-center gap-1.5"
                    >
                      <Swords size={13} /> Challenge
                    </button>
                    <button
                      onClick={() => setConfirmRemove(f.wallet)}
                      className="shrink-0 px-3 min-h-9 rounded-lg border border-valor-border text-slate-400 font-bold text-xs hover:text-red-300 hover:border-red-500/50 transition-colors flex items-center gap-1.5"
                    >
                      <UserMinus size={13} /> Remove friend
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Requests ──────────────────────────────────────────────────────── */}
        {tab === 'requests' && !loading && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="font-display font-black text-white text-sm uppercase tracking-wider">Incoming</p>
              {incoming.length === 0 && <p className="text-slate-500 text-sm">No pending requests.</p>}
              {incoming.map((f: FriendRequestEntry) => (
                <div key={f.wallet} className="rounded-xl border border-valor-border bg-valor-surface-2/50 px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm truncate">{who(f)}</p>
                    <p className="text-slate-500 text-[11px] uppercase tracking-wider">{f.rank}</p>
                  </div>
                  <button
                    onClick={() => void withBusy(f.wallet, () => acceptRequest(f.wallet))}
                    disabled={busyWallet === f.wallet}
                    className="shrink-0 w-9 h-9 rounded-lg bg-valor-gold text-black hover:bg-valor-gold-light transition-colors disabled:opacity-40 flex items-center justify-center"
                    aria-label={`Accept ${who(f)}`}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    onClick={() => void withBusy(f.wallet, () => removeFriend(f.wallet))}
                    disabled={busyWallet === f.wallet}
                    className="shrink-0 w-9 h-9 rounded-lg border border-valor-border text-slate-400 hover:text-red-300 hover:border-red-500/50 transition-colors disabled:opacity-40 flex items-center justify-center"
                    aria-label={`Decline ${who(f)}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <p className="font-display font-black text-white text-sm uppercase tracking-wider">Sent</p>
              {outgoing.length === 0 && <p className="text-slate-500 text-sm">No outgoing requests.</p>}
              {outgoing.map((f: FriendRequestEntry) => (
                <div key={f.wallet} className="rounded-xl border border-valor-border bg-valor-surface-2/50 px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm truncate">{who(f)}</p>
                    <p className="text-slate-500 text-[11px] uppercase tracking-wider">Waiting for response</p>
                  </div>
                  <button
                    onClick={() => void withBusy(f.wallet, () => removeFriend(f.wallet))}
                    disabled={busyWallet === f.wallet}
                    className="shrink-0 px-3 min-h-9 rounded-lg border border-valor-border text-slate-300 font-bold text-xs hover:text-white transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
