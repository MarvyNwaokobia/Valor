'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, UserPlus, UserMinus, Swords, MessageCircle, Search, Check, X, Loader2 } from 'lucide-react'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useFriends, type FriendEntry, type FriendRequestEntry } from '@/hooks/useFriends'
import { useUnreadCounts } from '@/hooks/useChat'
import LoadingScreen from '@/components/ui/LoadingScreen'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

const who = (f: { username: string | null; character_name: string }) => f.username || f.character_name

type Tab = 'friends' | 'requests'

interface Suggestion {
  wallet_address: string
  username:       string | null
  character_name: string
  rank:           string
}

/** Minimum length before a suggestion lookup fires — one or two characters
 *  would match half the roster and just be noise. */
const MIN_SUGGEST_LEN = 2
const SUGGEST_DEBOUNCE_MS = 300
// Below this, the list fits on screen without scrolling — a search box would
// just be one more thing to look at for nothing it actually filters.
const FILTER_THRESHOLD = 5

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
  const playerSynced = usePlayerStore((s) => s.playerSynced)
  const { friends, incoming, outgoing, loading, error, sendRequest, acceptRequest, removeFriend } =
    useFriends(address)
  const { byWallet: unreadByWallet } = useUnreadCounts(address)

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

  // ── Add-a-friend typeahead ──────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const latestQuery = useRef('')

  // ── Search-within-list ───────────────────────────────────────────────────────
  const [listFilter, setListFilter] = useState('')

  useEffect(() => {
    // Wallet addresses aren't matched by the search endpoint (it's a LIKE
    // over character_name/username), so there's nothing useful to suggest.
    if (!address || addBy === 'wallet') { setSuggestions([]); return }
    const q = identifier.trim()
    latestQuery.current = q
    if (q.length < MIN_SUGGEST_LEN) { setSuggestions([]); return }

    const handle = setTimeout(() => {
      fetch(`${API}/players/search?q=${encodeURIComponent(q)}&exclude=${address}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: Suggestion[]) => {
          // A slower earlier request could otherwise land after a faster
          // later one and clobber it with stale results.
          if (latestQuery.current === q) { setSuggestions(rows); setHighlight(-1) }
        })
        .catch(() => {})
    }, SUGGEST_DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [identifier, addBy, address])

  if (status === 'loading') return <LoadingScreen />
  if (status === 'unauthenticated' || !address) { router.replace('/'); return null }
  if (!player && !playerSynced) return <LoadingScreen />
  if (!player) { router.replace('/'); return null }

  const onAdd = async (explicitIdentifier?: string) => {
    const value = (explicitIdentifier ?? identifier).trim()
    if (!value) return
    setSuggestions([])
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

  const filterQ = listFilter.trim().toLowerCase()
  const filteredFriends  = filterQ ? friends.filter((f) => who(f).toLowerCase().includes(filterQ))  : friends
  const filteredIncoming = filterQ ? incoming.filter((f) => who(f).toLowerCase().includes(filterQ)) : incoming
  const filteredOutgoing = filterQ ? outgoing.filter((f) => who(f).toLowerCase().includes(filterQ)) : outgoing

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

          <div className="flex gap-2 relative">
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setSuggestOpen(false)}
              onKeyDown={(e) => {
                const showing = suggestOpen && addBy !== 'wallet' && suggestions.length > 0
                if (showing && e.key === 'ArrowDown') { e.preventDefault(); setHighlight((i) => Math.min(i + 1, suggestions.length - 1)); return }
                if (showing && e.key === 'ArrowUp')   { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); return }
                if (showing && e.key === 'Escape')    { setSuggestions([]); return }
                if (showing && e.key === 'Enter' && highlight >= 0) { e.preventDefault(); void onAdd(suggestions[highlight].wallet_address); return }
                if (e.key === 'Enter') void onAdd()
              }}
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

            {/* Typeahead — wallet mode has nothing to suggest (the search
                endpoint matches names, not addresses). onMouseDown (not
                onClick) fires before the input's onBlur, so a tap here
                selects instead of just closing the dropdown. */}
            {suggestOpen && addBy !== 'wallet' && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-16 mt-1 rounded-lg border border-valor-border bg-valor-surface-2 shadow-lg overflow-hidden z-10">
                {suggestions.map((s, i) => (
                  <button
                    key={s.wallet_address}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); void onAdd(s.wallet_address) }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                      i === highlight ? 'bg-valor-gold/15' : 'hover:bg-valor-gold/[0.07]'
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-white font-bold text-sm truncate">{who(s)}</span>
                    </span>
                    <span className="shrink-0 text-slate-500 text-[10px] uppercase tracking-wider">{s.rank}</span>
                  </button>
                ))}
              </div>
            )}
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
              onClick={() => { setTab(t.id); setListFilter('') }}
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

        {/* Search-within-list — only worth showing once there's enough to scroll past. */}
        {!loading && ((tab === 'friends' && friends.length > FILTER_THRESHOLD) ||
          (tab === 'requests' && incoming.length + outgoing.length > FILTER_THRESHOLD)) && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder={tab === 'friends' ? 'Search your friends…' : 'Search requests…'}
              className="w-full min-h-10 rounded-lg border border-valor-border bg-valor-surface-2/50 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-valor-gold/50"
            />
          </div>
        )}

        {/* ── Friends list ──────────────────────────────────────────────────── */}
        {tab === 'friends' && !loading && (
          <div className="flex flex-col gap-2">
            {friends.length === 0 && (
              <p className="text-slate-500 text-sm">No friends yet — add one above.</p>
            )}
            {friends.length > 0 && filteredFriends.length === 0 && (
              <p className="text-slate-500 text-sm">No friends match &ldquo;{listFilter}&rdquo;.</p>
            )}
            {filteredFriends.map((f: FriendEntry) => (
              <div key={f.wallet} className={`rounded-xl border px-4 py-3 flex flex-col gap-2.5 transition-colors ${
                confirmRemove === f.wallet ? 'border-red-500/50 bg-red-500/[0.06]' : 'border-valor-border bg-valor-surface-2/50'
              }`}>
                {confirmRemove === f.wallet ? (
                  <>
                    <div className="min-w-0">
                      <p className="text-white font-bold text-sm">Remove {who(f)}?</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">They&apos;ll need to send a new request to be friends again.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setConfirmRemove(null)}
                        disabled={busyWallet === f.wallet}
                        className="flex-1 min-h-10 rounded-lg border border-valor-border bg-valor-surface-2 text-slate-300 font-bold text-xs hover:text-white transition-colors disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void withBusy(f.wallet, () => removeFriend(f.wallet)).then(() => setConfirmRemove(null))}
                        disabled={busyWallet === f.wallet}
                        className="flex-1 min-h-10 rounded-lg bg-red-500/90 text-white font-bold text-xs hover:bg-red-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                      >
                        {busyWallet === f.wallet ? <Loader2 className="animate-spin" size={13} /> : <UserMinus size={13} />}
                        Remove
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm truncate">{who(f)}</p>
                      <p className="text-slate-500 text-[11px] uppercase tracking-wider mt-0.5">{f.rank}</p>
                    </div>
                    <button
                      onClick={() => router.push(`/friends/chat/${f.wallet}?name=${encodeURIComponent(who(f))}`)}
                      className="relative shrink-0 px-3 min-h-10 rounded-lg bg-valor-gold text-black font-bold text-xs hover:bg-valor-gold-light transition-colors flex items-center gap-1.5"
                    >
                      <MessageCircle size={14} /> Chat
                      {!!unreadByWallet[f.wallet] && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
                          {unreadByWallet[f.wallet]}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => router.push(`/duels?challenge=${f.wallet}&name=${encodeURIComponent(who(f))}`)}
                      className="shrink-0 w-10 h-10 rounded-lg border border-valor-border text-slate-300 hover:text-white hover:border-valor-gold/50 transition-colors flex items-center justify-center"
                      aria-label={`Challenge ${who(f)}`}
                    >
                      <Swords size={16} />
                    </button>
                    <button
                      onClick={() => setConfirmRemove(f.wallet)}
                      className="shrink-0 w-10 h-10 rounded-lg border border-valor-border text-slate-400 hover:text-red-300 hover:border-red-500/50 transition-colors flex items-center justify-center"
                      aria-label={`Remove ${who(f)}`}
                    >
                      <UserMinus size={16} />
                    </button>
                  </div>
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
              {incoming.length > 0 && filteredIncoming.length === 0 && (
                <p className="text-slate-500 text-sm">No matches.</p>
              )}
              {filteredIncoming.map((f: FriendRequestEntry) => (
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
              {outgoing.length > 0 && filteredOutgoing.length === 0 && (
                <p className="text-slate-500 text-sm">No matches.</p>
              )}
              {filteredOutgoing.map((f: FriendRequestEntry) => (
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
