'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import type { Item } from '@/types'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { usePurchaseItem } from '@/hooks/useMarketplace'
import { GUN_CATALOG, gunDps } from '@/engine/combat/GunStats'
import { gunIdFromItemId, GunIcon } from './GunIcons'

/**
 * THE ARMOURY — every gun in the game, in one ranked list.
 *
 * Guns used to be scattered: each `legendary` got its own full-width banner, so the
 * page opened with four stacked hero panels before you reached anything else, and the
 * cheaper weapons sat in a generic grid alongside ammo and attachments. There was no
 * way to see the ladder you were buying up.
 *
 * This lists them in TIER ORDER with the number that actually matters — sustained DPS
 * — as a bar you can compare down the column. A weapon is a ladder purchase, so the
 * shop should read as a ladder.
 */

interface Props {
  items: Item[]
  walletAddress: string | undefined
}

function statLine(gunId: ReturnType<typeof gunIdFromItemId>): string {
  if (!gunId) return ''
  const g = GUN_CATALOG[gunId]
  return `${g.damage} dmg · ${g.fireRate} rpm · ${(g.accuracy * 100).toFixed(0)}% acc · ${g.magazine} rounds · ${g.reloadTime}s reload`
}

/** Seasonal items carry a real end date; everything else is on sale indefinitely. */
function seasonalState(item: Item): { seasonal: boolean; ended: boolean; endsAt: number | null } {
  const raw = (item as Item & { sale_ends_at?: string | null }).sale_ends_at
  if (!raw) return { seasonal: false, ended: false, endsAt: null }
  const t = new Date(raw).getTime()
  if (!Number.isFinite(t)) return { seasonal: false, ended: false, endsAt: null }
  return { seasonal: true, ended: t <= Date.now(), endsAt: t }
}

function countdown(ms: number): string {
  if (ms <= 0) return 'closed'
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`
}

export default function WeaponsShowcase({ items, walletAddress }: Props) {
  const inventory = usePlayerStore((s) => s.inventory)
  const { purchase, pendingItemId } = usePurchaseItem(walletAddress)
  const [error, setError] = useState<string | null>(null)

  // Only rows that resolve to a real gun, ordered by the ladder they form.
  const guns = items
    .map((item) => ({ item, gunId: gunIdFromItemId(item.id) }))
    .filter((r): r is { item: Item; gunId: NonNullable<ReturnType<typeof gunIdFromItemId>> } => !!r.gunId)
    .sort((a, b) => GUN_CATALOG[a.gunId].tier - GUN_CATALOG[b.gunId].tier)

  if (guns.length === 0) return null

  const maxDps = Math.max(...guns.map((g) => gunDps(GUN_CATALOG[g.gunId])))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-amber-500">The Armoury</p>
          <h2 className="font-display font-black text-white text-2xl tracking-wide">Every weapon, ranked</h2>
        </div>
        <p className="text-slate-600 text-xs hidden sm:block">sustained DPS · higher is better</p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {guns.map(({ item, gunId }, i) => {
        const g = GUN_CATALOG[gunId]
        const dps = gunDps(g)
        const owned = inventory.some((inv) => inv.item_id === item.id)
        const pending = pendingItemId === item.id
        const { seasonal, ended, endsAt } = seasonalState(item)
        const buyable = !owned && !ended

        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.3) }}
            className="relative overflow-hidden rounded-2xl border p-4 sm:p-5"
            style={{
              background: seasonal ? 'rgba(234,179,8,0.05)' : 'rgba(8,8,14,0.9)',
              borderColor: seasonal ? 'rgba(234,179,8,0.35)' : 'rgba(42,42,58,0.8)',
              opacity: ended ? 0.62 : 1,
            }}
          >
            <div className="flex items-center gap-4">
              {/* Tier + silhouette */}
              <div className="shrink-0 w-14 flex flex-col items-center gap-1">
                <GunIcon gunId={gunId} className="w-12 h-8 text-slate-300" />
                <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">T{g.tier}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-black text-white text-lg leading-tight">{g.name}</span>
                  {seasonal && !ended && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-bold text-amber-300"
                      style={{ background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.4)' }}>
                      Seasonal
                    </span>
                  )}
                  {ended && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-bold text-slate-400"
                      style={{ background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.3)' }}>
                      Season Exclusive · No Longer Sold
                    </span>
                  )}
                </div>

                {/* The DPS bar — the whole point of ranking them. */}
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full" style={{
                      width: `${(dps / maxDps) * 100}%`,
                      background: seasonal ? 'linear-gradient(90deg,#eab308,#f59e0b)' : 'linear-gradient(90deg,#475569,#94a3b8)',
                    }} />
                  </div>
                  <span className="text-xs font-bold tabular-nums text-slate-300 w-14 text-right">{dps.toFixed(0)} DPS</span>
                </div>

                <p className="text-slate-500 text-[11px] mt-1.5 leading-relaxed">{statLine(gunId)}</p>
                {seasonal && endsAt !== null && !ended && (
                  <p className="text-amber-500/80 text-[11px] mt-1 font-bold">
                    Leaves the shop when the season closes · {countdown(endsAt - Date.now())}
                  </p>
                )}
              </div>

              {/* Price + action */}
              <div className="shrink-0 flex flex-col items-end gap-2">
                <span className="font-display font-black text-lg" style={{ color: seasonal ? '#eab308' : '#e2e8f0' }}>
                  {Number(item.price_g).toLocaleString()} <span className="text-xs">G$</span>
                </span>
                {owned ? (
                  <span className="px-4 py-2 rounded-xl text-xs font-bold text-green-400"
                    style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                    ✓ Owned
                  </span>
                ) : ended ? (
                  <span className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(42,42,58,0.8)' }}>
                    Sale Ended
                  </span>
                ) : (
                  <button
                    onClick={async () => {
                      setError(null)
                      try { await purchase(item) } catch (e) {
                        setError(e instanceof Error ? e.message : 'Purchase failed')
                      }
                    }}
                    disabled={!buyable || pending || !walletAddress}
                    className="px-4 py-2 rounded-xl text-xs font-black text-black disabled:opacity-40"
                    style={{ background: seasonal ? '#eab308' : '#cbd5e1' }}
                  >
                    {pending ? 'Buying…' : 'Buy'}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
