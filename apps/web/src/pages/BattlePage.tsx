import { useNavigate } from 'react-router-dom'
import { useConnection } from 'wagmi'
import { usePlayerStore } from '@/stores/usePlayerStore'
import BattleArena from '@/components/battle/BattleArena'

export default function BattlePage() {
  const { address } = useConnection()
  const navigate = useNavigate()
  const player = usePlayerStore((s) => s.player)

  if (!address || !player) {
    navigate('/')
    return null
  }

  return (
    <div className="max-w-2xl mx-auto">
      <BattleArena player={player} walletAddress={address} />
    </div>
  )
}
