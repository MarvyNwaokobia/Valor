'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// Chain-only analytics, produced by the separate Analytics repo (github.com/MarvyNwaokobia/Analytics)
// and published as JSON. Everything here is derived from Valor's contract events on Celo.
// GitHub's API returns the latest committed file with no CDN lag; the raw URL is cached for ~5 minutes.
const FEED_API =
  process.env.NEXT_PUBLIC_ANALYTICS_API_URL ??
  'https://api.github.com/repos/MarvyNwaokobia/Analytics/contents/public/valor.json?ref=main'
const FEED =
  process.env.NEXT_PUBLIC_ANALYTICS_URL ??
  'https://raw.githubusercontent.com/MarvyNwaokobia/Analytics/main/public/valor.json'
const SESSION_KEY = 'valor-admin-session' // same key AdminPage writes

interface Day { date: string; txs: number; newPlayers: number; activePlayers: number; gMoved: number; gSpent: number; marketplaceSpend: number; rewards: number }
interface Week { weekStart: string; active: number; newPlayers: number; retainedNextWeek: number | null }
interface Target { id: string; label: string; kind: string; target: number; actual: number | null; baseline: number | null; pct: number | null }
interface Epoch { epoch: number; start: string; end: string; status: string; txs: number; gMoved: number; gSpent: number; revenue: number; rewards: number; newPlayers: number; activePlayers: number }
interface Report {
  name: string; asOf: string; startDate: string
  definitions: Record<string, string>
  excludedWallets: { wallet: string; label: string }[]
  totals: Record<string, number | string | null>
  days: Day[]; weekly: Week[]; latestRetentionPct: number | null
  season: { name: string; start: string; end: string; started: boolean; targets: Target[]; epochs: Epoch[] } | null
}

const n = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined ? 'n/a' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d })

function hasAdminSession(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return false
    return (JSON.parse(raw) as { expires_at: number }).expires_at * 1000 > Date.now()
  } catch {
    return false
  }
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-1">
      <p className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">{label}</p>
      <p className="font-display font-black text-white text-2xl leading-none">{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  )
}

// Bars with a hover title; one metric, from project start. No chart library needed.
function Bars({ title, data, color = '#eab308', unit = '' }: { title: string; data: { label: string; v: number }[]; color?: string; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  const total = data.reduce((s, d) => s + d.v, 0)
  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{title}</p>
        <p className="text-[10px] text-slate-500">total {n(total)}{unit}</p>
      </div>
      <div className="flex items-end gap-px h-24 overflow-hidden" role="img" aria-label={title}>
        {data.map((d) => (
          <div
            key={d.label}
            title={`${d.label}: ${n(d.v)}${unit}`}
            className="flex-1 basis-0 min-w-0 rounded-t-sm"
            style={{ height: `${Math.max(d.v > 0 ? 3 : 0, (d.v / max) * 100)}%`, background: color, opacity: d.v > 0 ? 1 : 0.15 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-slate-600">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  )
}

export default function AdminAnalyticsPage() {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [range, setRange] = useState<'all' | '30' | '7'>('all')

  useEffect(() => { setAuthed(hasAdminSession()); setReady(true) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let res = await fetch(FEED_API, { headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-store' }).catch(() => null)
      if (!res || !res.ok) res = await fetch(`${FEED}?t=${Date.now()}`, { cache: 'no-store' }) // API rate-limited: fall back
      if (!res.ok) throw new Error(`feed returned ${res.status}`)
      setData(await res.json())
      setFetchedAt(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load the analytics feed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (authed) void load() }, [authed, load])

  const days = useMemo(() => {
    if (!data) return []
    return range === 'all' ? data.days : data.days.slice(-Number(range))
  }, [data, range])

  if (!ready) return null
  if (!authed) {
    return (
      <div className="max-w-md mx-auto py-12 text-center">
        <p className="text-slate-300 mb-4">Sign in on the admin page first.</p>
        <Link href="/admin" className="inline-block px-5 py-3 rounded-xl font-display font-black text-black" style={{ background: '#eab308' }}>Go to admin</Link>
      </div>
    )
  }

  const t = data?.totals ?? {}
  const tot = (k: string) => (t[k] as number | undefined) ?? 0
  const series = (k: keyof Day) => days.map((d) => ({ label: d.date, v: d[k] as number }))

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-amber-500">Admin</p>
          <h1 className="font-display font-black text-white text-2xl tracking-wide">On-chain Analytics</h1>
          <p className="text-xs text-slate-500 mt-1">
            Read straight from Valor&apos;s contracts on Celo{data ? `, since ${data.startDate}. Data as of ${new Date(data.asOf).toLocaleString()}; it updates every hour` : ''}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin" className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-slate-400">Season stats</Link>
          <button onClick={() => void load()} disabled={loading} className="px-3 py-1.5 rounded-lg text-xs font-bold text-black disabled:opacity-50" style={{ background: '#eab308' }}>
            {loading ? 'Loading' : fetchedAt ? `Refresh (checked ${fetchedAt.toLocaleTimeString()})` : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
          Could not load analytics: {error}. The feed is published by the Analytics repo (<code>npm run refresh</code> then push <code>public/valor.json</code>).
        </div>
      )}

      {data && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">Players</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="Players" value={n(tot('players'))} sub="characters claimed, same as Dune" />
              <Tile label="Verified right now" value={n(tot('verifiedNow'))} sub="lower bound, GoodDollar whitelists lapse" />
              <Tile label="Active this month" value={n(tot('mau'))} sub="players, last 30 days" />
              <Tile label="Active this week" value={n(tot('wau'))} sub="players, last 7 days" />
              <Tile label="Weekly retention" value={data.latestRetentionPct === null ? 'n/a' : `${data.latestRetentionPct}%`} sub="last full week, players" />
              <Tile label="Battles recorded" value={n(tot('battles'))} />
              <Tile label="Earners" value={n(tot('earners'))} sub="wallets paid by a reward pool" />
              <Tile label="Items on-chain" value={n(tot('itemsRegistered'))} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">Transactions and G$</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="On-chain txs" value={n(tot('txs'))} sub={`${n(tot('txsLast30d'))} in 30d, ${n(tot('txsLast7d'))} in 7d`} />
              <Tile label="G$ moved" value={n(tot('gMoved'))} sub="in + out, team wallets excluded" />
              <Tile label="G$ spent in app" value={n(tot('gSpentInApp'))} sub="players into Valor contracts" />
              <Tile label="Spent in marketplace" value={n(tot('gSpentMarketplace'))} sub={`${n(tot('marketplacePurchases'))} purchases`} />
              <Tile label="Marketplace revenue" value={n(tot('marketplaceRevenue'))} sub={`${n(tot('marketplaceRevenueWithdrawn'))} withdrawn`} />
              <Tile label="Rewards paid out" value={n(tot('rewardsPaid'))} sub="from both reward pools" />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">Daily activity</h2>
              <div className="flex gap-1">
                {(['all', '30', '7'] as const).map((r) => (
                  <button key={r} onClick={() => setRange(r)} className="px-2.5 py-1 rounded-md text-[11px] font-bold"
                    style={{ background: range === r ? '#eab308' : 'rgba(255,255,255,0.05)', color: range === r ? '#000' : '#94a3b8' }}>
                    {r === 'all' ? 'Since June' : `${r}d`}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <Bars title="Transactions per day" data={series('txs')} />
              <Bars title="Active players per day" data={series('activePlayers')} color="#22c55e" />
              <Bars title="New players per day" data={series('newPlayers')} color="#38bdf8" />
              <Bars title="G$ moved per day" data={series('gMoved')} color="#a78bfa" unit=" G$" />
              <Bars title="G$ spent in marketplace per day" data={series('marketplaceSpend')} color="#f97316" unit=" G$" />
              <Bars title="Rewards paid per day" data={series('rewards')} color="#ef4444" unit=" G$" />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">Weekly players</h2>
            <div className="bg-valor-surface border border-valor-border rounded-xl overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500 text-left"><th className="p-3">Week of</th><th className="p-3">Active</th><th className="p-3">New</th><th className="p-3">Back next week</th></tr></thead>
                <tbody>
                  {[...data.weekly].reverse().map((w) => (
                    <tr key={w.weekStart} className="border-t border-valor-border text-slate-300">
                      <td className="p-3">{w.weekStart}</td><td className="p-3">{n(w.active)}</td><td className="p-3">{n(w.newPlayers)}</td>
                      <td className="p-3">{w.retainedNextWeek === null ? 'in progress' : `${n(w.retainedNextWeek)} (${Math.round((100 * w.retainedNextWeek) / Math.max(1, w.active))}%)`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.season && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">
                {data.season.name}, {data.season.start} to {data.season.end}{data.season.started ? '' : ' (starts soon)'}
              </h2>
              <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-4">
                {data.season.targets.map((x) => (
                  <div key={x.id} className="flex flex-col gap-1.5">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-slate-300">{x.label}</span>
                      <span className="text-slate-400">
                        {x.actual === null ? <em>not on-chain</em> : n(x.actual, x.id === 'weeklyRetentionPct' ? 1 : 0)} / {n(x.target)}
                        {x.pct !== null && <b className="text-white ml-2">{x.pct}%</b>}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, x.pct ?? 0)}%`, background: '#eab308' }} />
                    </div>
                    {x.kind !== 'offchain' && x.baseline !== null && x.kind === 'stock' && (
                      <p className="text-[10px] text-slate-600">at season start: {n(x.baseline)}</p>
                    )}
                  </div>
                ))}
                <p className="text-[10px] text-slate-600">
                  Players, active and retention are live totals. G$, revenue, txs and earners count from the season start. Groups and Face-Off stakes are not in the contract data.
                </p>
              </div>
              <div className="bg-valor-surface border border-valor-border rounded-xl overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-500 text-left">
                    <th className="p-3">Epoch</th><th className="p-3">Window</th><th className="p-3">Txs</th><th className="p-3">New</th><th className="p-3">Active</th><th className="p-3">G$ moved</th><th className="p-3">Spent</th><th className="p-3">Revenue</th><th className="p-3">Rewards</th>
                  </tr></thead>
                  <tbody>
                    {data.season.epochs.map((e) => (
                      <tr key={e.epoch} className="border-t border-valor-border text-slate-300">
                        <td className="p-3">{e.epoch} <span className="text-slate-600">{e.status}</span></td>
                        <td className="p-3 whitespace-nowrap">{e.start} to {e.end}</td>
                        <td className="p-3">{n(e.txs)}</td><td className="p-3">{n(e.newPlayers)}</td><td className="p-3">{n(e.activePlayers)}</td>
                        <td className="p-3">{n(e.gMoved)}</td><td className="p-3">{n(e.gSpent)}</td><td className="p-3">{n(e.revenue)}</td><td className="p-3">{n(e.rewards)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-bold">How this is counted</h2>
            <div className="bg-valor-surface border border-valor-border rounded-xl p-4 text-[11px] text-slate-400 flex flex-col gap-2">
              {Object.entries(data.definitions).map(([k, v]) => <p key={k}><b className="text-slate-300">{k}:</b> {v}</p>)}
              <p><b className="text-slate-300">excluded wallets:</b> {data.excludedWallets.map((w) => `${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)} (${w.label})`).join('; ')}</p>
              <p>Verified status is a live GoodDollar whitelist snapshot{data.totals.verifiedCheckedAt ? ` from ${new Date(String(data.totals.verifiedCheckedAt)).toLocaleDateString()}` : ''}; it can drop when GoodDollar un-whitelists a wallet.</p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
