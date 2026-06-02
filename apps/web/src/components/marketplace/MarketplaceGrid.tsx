import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Item } from '@/types'
import { ITEM_RARITY_COLORS } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'
import MarketplaceItem from './MarketplaceItem'

interface Props {
  walletAddress: string | undefined
}

export default function MarketplaceGrid({ walletAddress }: Props) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['marketplace-items'],
    queryFn: async () => {
      const { data } = await supabase.from('items').select('*').order('price_g')
      return (data ?? []) as Item[]
    },
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-48 bg-valor-surface rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  const categories = ['weapon', 'shield', 'booster'] as const

  return (
    <div className="flex flex-col gap-8">
      {categories.map((cat) => {
        const catItems = items.filter((i) => i.category === cat)
        if (catItems.length === 0) return null
        return (
          <section key={cat}>
            <h2 className="font-display font-bold text-white capitalize mb-3">{cat}s</h2>
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
