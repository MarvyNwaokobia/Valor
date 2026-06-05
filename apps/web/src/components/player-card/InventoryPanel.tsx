import { useQuery } from '@tanstack/react-query'
import type { InventoryItem, Item } from '@/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
import { ITEM_RARITY_COLORS } from '@/lib/constants'
import { usePlayerStore } from '@/stores/usePlayerStore'

interface Props {
  inventory: InventoryItem[]
}

export default function InventoryPanel({ inventory }: Props) {
  const toggleEquip = usePlayerStore((s) => s.toggleEquip)

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

  if (inventory.length === 0) {
    return (
      <div className="bg-valor-surface border border-valor-border rounded-xl p-6 text-center">
        <p className="text-slate-500 text-sm">No items yet. Visit the marketplace.</p>
      </div>
    )
  }

  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-5">
      <h3 className="font-display font-bold text-white mb-4">Inventory</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {inventory.map((inv) => {
          const item = itemMap.get(inv.item_id)
          if (!item) return null
          const color = ITEM_RARITY_COLORS[item.rarity]

          return (
            <button
              key={inv.item_id}
              onClick={() => toggleEquip(inv.item_id)}
              className={`flex flex-col gap-2 p-3 rounded-lg border text-left transition-all ${
                inv.equipped
                  ? 'border-valor-gold bg-valor-gold/10'
                  : 'border-valor-border bg-valor-surface-2 hover:border-slate-500'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold" style={{ color }}>
                  {item.rarity.toUpperCase()}
                </span>
                {inv.equipped && (
                  <span className="text-xs bg-valor-gold text-black px-1.5 rounded font-bold">
                    EQ
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-white leading-tight">{item.name}</p>
              <p className="text-xs text-slate-500">+{item.stat_boost} {item.category === 'weapon' ? 'ATK' : item.category === 'shield' ? 'DEF' : 'XP'}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
