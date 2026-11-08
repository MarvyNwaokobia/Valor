'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
// Same key AdminPage writes, so signing in there signs you in here (same tab).
const SESSION_KEY = 'valor-admin-session'

interface AdminGroup { id: string; slug: string; name: string; active: boolean; members: number }
interface BoardEntry { rank: number; wallet_address: string; username: string | null; waves: number; joined_at: string }
interface AdminSeason { id: string; name: string; starts_at: string; ends_at: string | null; prize_pool_g: number; payout_status: string; payout_group: string | null }
interface Board { group: { slug: string; name: string }; season: { id: string; name: string } | null; entries: BoardEntry[] }

function loadToken(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as { token: string; expires_at: number }
    return s.expires_at * 1000 > Date.now() ? s.token : null
  } catch {
    return null
  }
}

export default function AdminGroupsPage() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [groups, setGroups] = useState<AdminGroup[]>([])
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [seasons, setSeasons] = useState<AdminSeason[]>([])
  const [pickSeason, setPickSeason] = useState('')
  const [pickGroup, setPickGroup] = useState('')

  useEffect(() => { setToken(loadToken()); setReady(true) }, [])

  const authed = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } }),
    [token],
  )

  const load = useCallback(async () => {
    const res = await authed('/admin/groups')
    if (res.ok) setGroups((await res.json()).groups ?? [])
    else if (res.status === 401) setToken(null)
  }, [authed])

  const loadSeasons = useCallback(async () => {
    const res = await authed('/admin/groups/seasons')
    if (res.ok) {
      const list: AdminSeason[] = (await res.json()).seasons ?? []
      setSeasons(list)
      setPickSeason((cur) => cur || list[0]?.id || '')
    }
  }, [authed])

  useEffect(() => { if (token) { void load(); void loadSeasons() } }, [token, load, loadSeasons])

  async function setPayoutGroup(slugOrNull: string | null) {
    if (!pickSeason) return
    const s = seasons.find((x) => x.id === pickSeason)
    const label = slugOrNull ? `Pay the prize of "${s?.name}" to ${slugOrNull} members only?` : `Clear the group restriction on "${s?.name}"?`
    if (!window.confirm(label)) return
    setMsg(null)
    const res = await authed(`/admin/seasons/${pickSeason}/payout-group`, { method: 'POST', body: JSON.stringify({ slug: slugOrNull }) })
    const j = await res.json().catch(() => ({}))
    setMsg(res.ok ? 'Saved.' : (j as { error?: string }).error ?? 'Could not save')
    if (res.ok) await loadSeasons()
  }

  async function create() {
    setMsg(null)
    const res = await authed('/admin/groups', {
      method: 'POST',
      body: JSON.stringify({ slug: slug.trim().toLowerCase(), name: name.trim(), description: description.trim() }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { setSlug(''); setName(''); setDescription(''); setMsg('Group created.'); await load() }
    else setMsg((j as { error?: string }).error ?? 'Could not create group')
  }

  async function showBoard(s: string) {
    if (open === s) { setOpen(null); setBoard(null); return }
    setOpen(s); setBoard(null)
    const res = await fetch(`${API}/groups/${encodeURIComponent(s)}/board?limit=100`)
    if (res.ok) setBoard(await res.json())
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  if (!ready) return null
  if (!token) {
    return (
      <div className="max-w-md mx-auto py-12 text-center">
        <h1 className="font-display font-black text-2xl text-white mb-2">Groups admin</h1>
        <p className="text-slate-400 text-sm mb-4">Sign in on the admin page first, then come back here in the same tab.</p>
        <Link href="/admin" className="inline-block px-5 py-3 rounded-xl font-display font-black text-black" style={{ background: '#eab308' }}>Go to admin</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-8 flex flex-col gap-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display font-black text-2xl text-white">Groups</h1>
        <Link href="/admin" className="text-xs text-slate-500 hover:text-slate-300">back to admin</Link>
      </div>

      <section className="flex flex-col gap-3">
        {groups.length === 0 && <p className="text-slate-600 text-sm">No groups yet.</p>}
        {groups.map((g) => {
          const link = `${origin}/join/${g.slug}`
          return (
            <div key={g.id} className="rounded-xl border border-slate-800 p-4" style={{ background: 'rgba(8,8,14,0.9)' }}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold">{g.name} <span className="text-slate-500 font-normal text-xs">· {g.members} members</span></p>
                  <p className="text-slate-500 text-xs truncate">{link}</p>
                </div>
                <button onClick={() => void navigator.clipboard?.writeText(link).then(() => setMsg(`Copied ${link}`))}
                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Copy link</button>
                <button onClick={() => void showBoard(g.slug)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">{open === g.slug ? 'Hide' : 'Board'}</button>
              </div>

              {open === g.slug && (
                <div className="mt-4">
                  {!board ? <p className="text-slate-600 text-sm">loading…</p> : (
                    <>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
                        {board.season ? `Season: ${board.season.name}` : 'No season yet'}
                      </p>
                      {board.entries.length === 0 ? <p className="text-slate-600 text-sm">No scores yet.</p> : (
                        <div className="flex flex-col gap-1">
                          {board.entries.map((e) => (
                            <div key={e.wallet_address} className="flex items-center gap-3 text-sm">
                              <span className="w-6 text-slate-500 tabular-nums">{e.rank}</span>
                              <span className="text-white w-28 truncate">{e.username ?? '(no username)'}</span>
                              <span className="flex-1 text-slate-500 text-xs font-mono truncate">{e.wallet_address}</span>
                              <span className="text-white font-bold tabular-nums">{e.waves}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-slate-600 mt-3">Full wallets shown so you can confirm the top 3 are real members before paying.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

      <section className="rounded-xl border border-slate-800 p-4 flex flex-col gap-3" style={{ background: 'rgba(8,8,14,0.9)' }}>
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500">Season prize goes to</p>
        <p className="text-slate-500 text-xs">Everyone can play and appears on the board. This limits who is paid. Set it before you run the payout; it locks once winners are committed.</p>
        <select value={pickSeason} onChange={(e) => setPickSeason(e.target.value)}
                className="bg-transparent border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
          {seasons.map((s) => (
            <option key={s.id} value={s.id} className="bg-black">
              {s.name} · {s.prize_pool_g.toLocaleString()} G$ · {s.payout_group ? `${s.payout_group} only` : 'overall board'}
            </option>
          ))}
        </select>
        <select value={pickGroup} onChange={(e) => setPickGroup(e.target.value)}
                className="bg-transparent border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
          <option value="" className="bg-black">Choose a group…</option>
          {groups.map((g) => <option key={g.id} value={g.slug} className="bg-black">{g.name}</option>)}
        </select>
        <div className="flex gap-3">
          <button onClick={() => void setPayoutGroup(pickGroup)} disabled={!pickSeason || !pickGroup}
                  className="flex-1 px-4 py-2.5 rounded-lg font-display font-black text-black disabled:opacity-40" style={{ background: '#eab308' }}>
            Pay this group only
          </button>
          <button onClick={() => void setPayoutGroup(null)} disabled={!pickSeason}
                  className="px-4 py-2.5 rounded-lg font-bold text-white border border-slate-700 disabled:opacity-40">
            Clear
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 p-4 flex flex-col gap-3" style={{ background: 'rgba(8,8,14,0.9)' }}>
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-slate-500">New group</p>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug (e.g. unilag), becomes /join/unilag"
               className="bg-transparent border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name (e.g. UNILAG)"
               className="bg-transparent border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)"
               className="bg-transparent border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
        <button onClick={() => void create()} disabled={!slug.trim() || !name.trim()}
                className="px-4 py-2.5 rounded-lg font-display font-black text-black disabled:opacity-40" style={{ background: '#eab308' }}>
          Create group
        </button>
      </section>

      {msg && <p className="text-sm text-amber-400">{msg}</p>}
    </div>
  )
}
