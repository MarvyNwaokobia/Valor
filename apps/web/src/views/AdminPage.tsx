'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useActiveWalletClient } from '@/hooks/useActiveWalletClient'
import { formatGDollarNumber } from '@/utils/format'

const API = process.env.NEXT_PUBLIC_API_URL ?? ''
const SESSION_KEY = 'valor-admin-session'

interface AdminSession {
  token: string
  wallet: string
  expires_at: number
}

interface Season {
  id: string
  name: string
  starts_at: string
  ends_at: string | null
}

interface AdminStats {
  season_name: string | null
  starts_at: string
  ends_at: string | null
  new_players: number
  active_players: number
  total_battles: number
  total_g_awarded: number
  total_g_volume: number
}

function loadSession(): AdminSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed: AdminSession = JSON.parse(raw)
    if (parsed.expires_at * 1000 <= Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-1">
      <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className="font-display font-black text-white text-2xl leading-none">{value}</p>
    </div>
  )
}

export default function AdminPage() {
  const { address } = useResolvedAuth()
  const walletClient = useActiveWalletClient()

  const [session, setSession] = useState<AdminSession | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const [seasons, setSeasons] = useState<Season[]>([])
  const [selectedSeason, setSelectedSeason] = useState<string | 'all'>('all')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setSession(loadSession()) }, [])

  async function handleAdminLogin() {
    if (!address || !walletClient?.account) return
    setLoggingIn(true)
    setLoginError(null)
    try {
      const message = `Valor Admin Login\ntimestamp:${Math.floor(Date.now() / 1000)}`
      const signature = await walletClient.signMessage({ account: walletClient.account, message })

      const res = await fetch(`${API}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, message, signature }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Login failed' }))
        throw new Error(body.error ?? 'Login failed')
      }
      const data: AdminSession = await res.json()
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data))
      setSession(data)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoggingIn(false)
    }
  }

  const authedFetch = useCallback(
    (path: string, init?: RequestInit) => {
      if (!session) return Promise.reject(new Error('Not signed in'))
      return fetch(`${API}${path}`, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${session.token}` },
      })
    },
    [session],
  )

  const refreshSeasons = useCallback(async () => {
    const res = await authedFetch('/admin/seasons')
    if (res.ok) setSeasons(await res.json())
  }, [authedFetch])

  const refreshStats = useCallback(async () => {
    const qs = selectedSeason === 'all' ? '' : `?season_id=${selectedSeason}`
    const res = await authedFetch(`/admin/stats${qs}`)
    if (res.ok) setStats(await res.json())
  }, [authedFetch, selectedSeason])

  useEffect(() => {
    if (!session) return
    refreshSeasons()
  }, [session, refreshSeasons])

  useEffect(() => {
    if (!session) return
    refreshStats()
  }, [session, refreshStats])

  async function handleCreateSeason() {
    if (!newSeasonName.trim()) return
    setBusy(true)
    try {
      const res = await authedFetch('/admin/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSeasonName.trim() }),
      })
      if (res.ok) {
        setNewSeasonName('')
        await refreshSeasons()
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleEndSeason(id: string) {
    setBusy(true)
    try {
      const res = await authedFetch(`/admin/seasons/${id}/end`, { method: 'POST' })
      if (res.ok) await refreshSeasons()
    } finally {
      setBusy(false)
    }
  }

  const openSeason = seasons.find((s) => !s.ends_at)

  if (!session) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center" style={{ background: '#04030c' }}>
        <p className="font-display font-black text-white text-2xl">Valor Admin</p>
        <p className="text-slate-400 text-sm max-w-xs">Sign a message with your admin wallet to view season and G$ volume stats.</p>
        {loginError && <p className="text-red-400 text-xs">{loginError}</p>}
        <motion.button
          onClick={handleAdminLogin}
          disabled={loggingIn || !address}
          whileTap={{ scale: 0.97 }}
          className="px-6 py-3 rounded-xl font-black text-sm uppercase tracking-widest text-black disabled:opacity-50"
          style={{ background: '#eab308' }}
        >
          {loggingIn ? 'Signing…' : 'Sign in as Admin'}
        </motion.button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-amber-500">Admin</p>
        <h1 className="font-display font-black text-white text-2xl tracking-wide">Season Stats</h1>
      </div>

      {/* Season picker */}
      <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedSeason('all')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
            style={{
              background: selectedSeason === 'all' ? '#eab308' : 'rgba(255,255,255,0.05)',
              color: selectedSeason === 'all' ? '#000' : '#94a3b8',
            }}
          >
            All time
          </button>
          {seasons.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSeason(s.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{
                background: selectedSeason === s.id ? '#eab308' : 'rgba(255,255,255,0.05)',
                color: selectedSeason === s.id ? '#000' : '#94a3b8',
              }}
            >
              {s.name}{!s.ends_at ? ' · open' : ''}
            </button>
          ))}
        </div>

        <div className="flex gap-2 pt-2 border-t" style={{ borderColor: 'rgba(42,42,58,0.8)' }}>
          <input
            type="text"
            value={newSeasonName}
            onChange={(e) => setNewSeasonName(e.target.value)}
            placeholder="New season name"
            className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-valor-border text-sm text-white placeholder:text-slate-600 focus:outline-none"
          />
          <button
            onClick={handleCreateSeason}
            disabled={busy || !newSeasonName.trim()}
            className="px-3 py-2 rounded-lg text-xs font-bold text-black disabled:opacity-50"
            style={{ background: '#eab308' }}
          >
            Start
          </button>
          {openSeason && (
            <button
              onClick={() => handleEndSeason(openSeason.id)}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-xs font-bold text-slate-300 hover:text-white border disabled:opacity-50"
              style={{ borderColor: '#2a2a3a' }}
            >
              End &quot;{openSeason.name}&quot;
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatTile label="New Players" value={stats.new_players.toLocaleString()} />
          <StatTile label="Active Players" value={stats.active_players.toLocaleString()} />
          <StatTile label="Total Battles" value={stats.total_battles.toLocaleString()} />
          <StatTile label="G$ Awarded" value={`${formatGDollarNumber(stats.total_g_awarded)} G$`} />
          <StatTile label="G$ Volume Moved" value={`${formatGDollarNumber(stats.total_g_volume)} G$`} />
        </div>
      )}
    </div>
  )
}
