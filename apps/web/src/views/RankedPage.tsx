'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useWeb3Auth } from '@web3auth/modal/react'
import { useWeb3AuthAddress } from '@/hooks/useWeb3AuthAddress'
import { usePlayerStore } from '@/stores/usePlayerStore'
import ChallengeBattle from '@/components/battle/ChallengeBattle'
import LoadingScreen from '@/components/ui/LoadingScreen'

/**
 * Ranked (async) PvP — the interim competitive loop while real-time PvP is built
 * (see docs/PVP_NETCODE.md). Challenge any warrior by wallet/name; the server
 * resolves the fight from both loadouts and awards XP to both. Decoupled from the
 * retired turn-based "Classic" page; reuses the existing ChallengeBattle flow.
 */
export default function RankedPage() {
  const { isInitialized: ready } = useWeb3Auth()
  const { address, status: addressStatus } = useWeb3AuthAddress()
  const router        = useRouter()
  const player        = usePlayerStore(s => s.player)
  const playerSynced  = usePlayerStore(s => s.playerSynced)
  const searchParams  = useSearchParams()
  const challengeTarget = searchParams.get('challenge') ?? undefined

  if (!ready) return <LoadingScreen />
  if (addressStatus === 'unauthenticated' || addressStatus === 'failed') { router.replace('/'); return null }
  if (addressStatus === 'resolving' || !address) return <LoadingScreen />
  if (!player && !playerSynced) return <LoadingScreen />
  if (!player) { router.replace('/'); return null }

  return (
    <div className="max-w-2xl mx-auto">
      <ChallengeBattle
        walletAddress={address}
        onBack={() => router.push('/')}
        prefillOpponent={challengeTarget}
      />
    </div>
  )
}
