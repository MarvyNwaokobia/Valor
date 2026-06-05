import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import type { InventoryItem, Item } from '@/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
import { ITEM_RARITY_COLORS } from '@/lib/constants'
import { usePlayerStore } from '@/stores/usePlayerStore'

interface Props {
  inventory: InventoryItem[]
  walletAddress?: string
}

const STAT_LABEL: Record<string, string> = {
  weapon:   'ATK',
  shield:   'DEF',
  booster:  'XP',
  cosmetic: 'STY',
}

export default function InventoryPanel({ inventory, walletAddress }: Props) {
  const toggleEquip   = usePlayerStore((s) => s.toggleEquip)
  const [toggling, setToggling] = useState<string | null>(null)
  const [flash, setFlash]       = useState<{ id: string; msg: string } | null>(null)

  const itemIds = inventory.map((i) => i.item_id)

  const { data: items = [] } = useQuery({
    queryKey: ['items', itemIds],
    queryFn: async () => {
      if (itemIds.length === 0) return []
      const res = await fetch(`${API}/items`)
      if (!res.ok) return []
      const all: Item[] = await res.json()
      return all.filter(i => itemIds.includes(i.id))
    },
    enabled: itemIds.length > 0,
  })

  const itemMap = new Map(items.map((i) => [i.id, i]))

  async function handleToggle(inv: InventoryItem) {
    if (!walletAddress || toggling) return
    const next = !inv.equipped
    setToggling(inv.item_id)
    toggleEquip(inv.item_id)   // optimistic

    try {
      const res = await fetch(`${API}/players/${walletAddress}/inventory/${inv.item_id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ equipped: next }),
      })
      if (!res.ok) {
        toggleEquip(inv.item_id)  // rollback
      } else {
        const item = itemMap.get(inv.item_id)
        const stat = item ? `+${item.stat_boost} ${STAT_LABEL[item.category] ?? ''}` : ''
        setFlash({ id: inv.item_id, msg: next ? `Equipped ${stat}` : 'Unequipped' })
        setTimeout(() => setFlash(null), 2000)
      }
    } catch {
      toggleEquip(inv.item_id)  // rollback on network error
    } finally {
      setToggling(null)
    }
  }

  if (inventory.length === 0) {
    return (
      <div className="bg-valor-surface border border-valor-border rounded-xl p-6 text-center">
        <p className="text-slate-500 text-sm">No items yet. Visit the marketplace.</p>
      </div>
    )
  }

  const equippedCount = inventory.filter(i => i.equipped).length

  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-bold text-white">Inventory</h3>
        <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">
          {equippedCount} equipped
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {inventory.map((inv) => {
          const item    = itemMap.get(inv.item_id)
          if (!item) return null
          const color   = ITEM_RARITY_COLORS[item.rarity]
          const statLbl = STAT_LABEL[item.category] ?? ''
          const isFlash = flash?.id === inv.item_id

          return (
            <button
              key={inv.item_id}
              onClick={() => handleToggle(inv)}
              disabled={toggling === inv.item_id || (!walletAddress)}
              className={`relative flex flex-col gap-2 p-3 rounded-lg border text-left transition-all disabled:opacity-60 ${
                inv.equipped
                  ? 'border-valor-gold bg-valor-gold/10 hover:bg-valor-gold/15'
                  : 'border-valor-border bg-valor-surface-2 hover:border-slate-500'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold" style={{ color }}>
                  {item.rarity.toUpperCase()}
                </span>
                {inv.equipped && (
                  <span className="text-[9px] bg-valor-gold text-black px-1.5 py-0.5 rounded font-black">
                    EQ
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-white leading-tight">{item.name}</p>
              <p className="text-xs text-slate-500">
                +{item.stat_boost} <span className="font-bold" style={{ color }}>{statLbl}</span>
              </p>

              <AnimatePresence>
                {isFlash && (
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center rounded-lg text-xs font-black pointer-events-none"
                    style={{ background: 'rgba(4,3,12,0.85)', color: inv.equipped ? '#eab308' : '#94a3b8' }}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {flash?.msg}
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          )
        })}
      </div>
    </div>
  )
}
