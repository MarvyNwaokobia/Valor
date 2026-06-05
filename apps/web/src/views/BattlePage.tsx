'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useConnection } from 'wagmi'
import { usePlayerStore } from '@/stores/usePlayerStore'
import BattleArena from '@/components/battle/BattleArena'

export default function BattlePage() {
  const { address } = useConnection()
  const router        = useRouter()
  const player        = usePlayerStore(s => s.player)
  const searchParams  = useSearchParams()
  const challengeTarget = searchParams.get('challenge') ?? undefined

  if (!address || !player) { router.replace('/'); return null }

  return (
    <div className="max-w-2xl mx-auto">
      <BattleArena player={player} walletAddress={address} challengeTarget={challengeTarget} />
    </div>
  )
}
