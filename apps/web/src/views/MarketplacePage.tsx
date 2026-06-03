import { useConnection } from 'wagmi'
import MarketplaceGrid from '@/components/marketplace/MarketplaceGrid'

export default function MarketplacePage() {
  const { address } = useConnection()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-white">Marketplace</h1>
        <p className="text-slate-400 text-sm mt-1">
          Spend G$ on weapons, shields, and boosters. All items are yours forever.
        </p>
      </div>
      <MarketplaceGrid walletAddress={address} />
    </div>
  )
}
