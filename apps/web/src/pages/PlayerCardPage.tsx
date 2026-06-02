import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Player } from '@/types'
import PlayerCard from '@/components/player-card/PlayerCard'
import LoadingScreen from '@/components/ui/LoadingScreen'

export default function PlayerCardPage() {
  const { walletAddress } = useParams<{ walletAddress: string }>()
  const [player, setPlayer] = useState<Player | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!walletAddress) return

    supabase
      .from('players')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single()
      .then(({ data }) => {
        if (data) setPlayer(data)
        else setNotFound(true)
        setLoading(false)
      })
  }, [walletAddress])

  if (loading) return <LoadingScreen />

  if (notFound || !player) {
    return (
      <div className="min-h-screen bg-valor-dark flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4">⚔️</p>
          <p className="text-white font-display text-xl">Warrior Not Found</p>
          <p className="text-slate-400 text-sm mt-2">This address has no character yet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-valor-dark flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <PlayerCard player={player} isPublic />
      </div>
    </div>
  )
}
