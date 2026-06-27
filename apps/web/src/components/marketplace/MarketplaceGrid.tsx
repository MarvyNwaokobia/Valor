import { useState } from 'react'
import { Crosshair, Zap, CircleDot, Wrench } from 'lucide-react'
import { useMarketplaceItems } from '@/hooks/useMarketplace'
import MarketplaceItem from './MarketplaceItem'
import LimitedItemBanner from './LimitedItemBanner'

interface Props {
  walletAddress: string | undefined
}

const CATEGORIES = ['weapon', 'ammo', 'attachment', 'booster'] as const
const CATEGORY_META = {
  weapon:     { label: 'Guns',        Icon: Crosshair },
  ammo:       { label: 'Ammo',        Icon: CircleDot },
  attachment: { label: 'Attachments', Icon: Wrench    },
  booster:    { label: 'Boosters',    Icon: Zap       },
} as const

export default function MarketplaceGrid({ walletAddress }: Props) {
  const { data: items = [], isLoading } = useMarketplaceItems()
  const [filter, setFilter] = useState<string>('all')

  const legendaryItems = items.filter((i) => i.rarity === 'legendary')
  const filteredItems = items.filter(
    (i) => i.rarity !== 'legendary' && (filter === 'all' || i.category === filter),
  )

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-52 bg-valor-surface rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Limited legendary items banner */}
      {legendaryItems.map((item) => (
        <LimitedItemBanner key={item.id} item={item} walletAddress={walletAddress} />
      ))}

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')} label="All" />
        {CATEGORIES.map((cat) => {
          const { label, Icon } = CATEGORY_META[cat]
          return (
            <FilterBtn
              key={cat}
              active={filter === cat}
              onClick={() => setFilter(cat)}
              label={label}
              Icon={Icon}
            />
          )
        })}
      </div>

      {/* Item grid */}
      {CATEGORIES.filter((cat) => filter === 'all' || filter === cat).map((cat) => {
        const catItems = filteredItems.filter((i) => i.category === cat)
        if (catItems.length === 0) return null
        const { label, Icon } = CATEGORY_META[cat]
        return (
          <section key={cat}>
            <h2 className="font-display font-bold text-white mb-3 flex items-center gap-2">
              <Icon size={16} strokeWidth={2} />
              {label}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {catItems.map((item) => (
                <MarketplaceItem key={item.id} item={item} walletAddress={walletAddress} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

import type { LucideIcon } from 'lucide-react'

function FilterBtn({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  Icon?: LucideIcon
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
        active
          ? 'bg-valor-gold text-black'
          : 'bg-valor-surface border border-valor-border text-slate-400 hover:border-slate-500 hover:text-white'
      }`}
    >
      {Icon && <Icon size={13} strokeWidth={2} />}
      {label}
    </button>
  )
}
