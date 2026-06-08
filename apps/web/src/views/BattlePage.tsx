'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { usePrivy } from '@privy-io/react-auth'
import { usePlayerStore } from '@/stores/usePlayerStore'
import BattleArena from '@/components/battle/BattleArena'
import LoadingScreen from '@/components/ui/LoadingScreen'

export default function BattlePage() {
  const { ready, authenticated } = usePrivy()
  const { address } = useAccount()
  const router        = useRouter()
  const player        = usePlayerStore(s => s.player)
  const searchParams  = useSearchParams()
  const challengeTarget = searchParams.get('challenge') ?? undefined

  if (!ready) return <LoadingScreen />
  if (!authenticated || !address) { router.replace('/'); return null }
  if (!player) return <LoadingScreen />

  return (
    <div className="max-w-2xl mx-auto">
      <BattleArena player={player} walletAddress={address} challengeTarget={challengeTarget} />
    </div>
  )
}
