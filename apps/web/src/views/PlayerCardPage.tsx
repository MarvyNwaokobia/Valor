import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Swords } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Player } from '@/types'
import PlayerCard from '@/components/player-card/PlayerCard'
import LoadingScreen from '@/components/ui/LoadingScreen'
import { RANK_COLORS } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'

export default function PlayerCardPage() {
  const params = useParams()
  const walletAddress = params?.walletAddress as string | undefined
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
        if (data) {
          setPlayer(data)
          // Update document title for sharing
          document.title = `${data.character_name} | Valor`
        } else {
          setNotFound(true)
        }
        setLoading(false)
      })

    return () => {
      document.title = 'Valor'
    }
  }, [walletAddress])

  if (loading) return <LoadingScreen />

  if (notFound || !player) {
    return (
      <div className="min-h-screen bg-valor-dark flex flex-col items-center justify-center gap-4 p-6">
        <Swords size={52} className="text-slate-600" strokeWidth={1.2} />
        <p className="text-white font-display text-2xl font-bold">Warrior Not Found</p>
        <p className="text-slate-400 text-sm">This address hasn't created a character yet.</p>
        <Link
          href="/"
          className="mt-2 px-6 py-2.5 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light transition-colors text-sm"
        >
          Enter Valor
        </Link>
      </div>
    )
  }

  const rankColor = RANK_COLORS[player.rank]

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0a0a0f 0%, #12121a 100%)' }}
    >
      {/* Rank-colored ambient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 40%, ${rankColor}0d 0%, transparent 65%)`,
        }}
      />

      <motion.div
        className="w-full max-w-sm z-10"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <PlayerCard player={player} isPublic />

        {/* CTA below card */}
        <motion.div
          className="mt-6 text-center flex flex-col gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <p className="text-slate-500 text-sm">
            <span className="text-valor-gold font-bold">{player.character_name}</span> has earned{' '}
            <span className="text-valor-gold font-bold">
              {formatGDollarNumber(player.g_earned_lifetime)}
            </span>{' '}
            playing Valor.
          </p>
          <Link
            href="/"
            className="inline-block px-8 py-3 bg-valor-gold text-black font-bold rounded-xl hover:bg-valor-gold-light transition-colors text-sm"
          >
            Create Your Character →
          </Link>
        </motion.div>
      </motion.div>
    </div>
  )
}
