import { useRouter } from 'next/navigation'
import { useConnection } from 'wagmi'
import { usePlayerStore } from '@/stores/usePlayerStore'
import PlayerCard from '@/components/player-card/PlayerCard'
import InventoryPanel from '@/components/player-card/InventoryPanel'
import DailyClaimButton from '@/components/player-card/DailyClaimButton'
import DecayPanel from '@/components/player-card/DecayPanel'
import IdlePanel from '@/components/idle/IdlePanel'

export default function ProfilePage() {
  const { address } = useConnection()
  const router = useRouter()
  const player = usePlayerStore((s) => s.player)
  const inventory = usePlayerStore((s) => s.inventory)

  if (!address || !player) {
    router.replace('/')
    return null
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      <div className="lg:sticky lg:top-24 w-full lg:w-80 shrink-0 flex flex-col gap-4">
        <PlayerCard player={player} showShareLink />
        <DecayPanel walletAddress={address} />
        <DailyClaimButton walletAddress={address} />
      </div>

      <div className="flex-1 flex flex-col gap-6">
        {(player.play_style === 'Wanderer' || player.play_style === 'Champion') && (
          <IdlePanel walletAddress={address} player={player} />
        )}
        <InventoryPanel inventory={inventory} />
      </div>
    </div>
  )
}
