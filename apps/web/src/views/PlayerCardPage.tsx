import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Swords, Copy, Check } from 'lucide-react'
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
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
  const [copied, setCopied] = useState(false)

  function copyCardUrl() {
    const url = `${window.location.origin}/card/${walletAddress}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  useEffect(() => {
    if (!walletAddress) return

    fetch(`${API}/players/${walletAddress}`)
      .then(async res => {
        if (!res.ok) { setNotFound(true); return }
        const data: Player = await res.json()
        setPlayer(data)
        document.title = `${data.character_name} | Valor`
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))

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
              {formatGDollarNumber(player.g_earned_lifetime)} G$
            </span>{' '}
            playing Valor.
          </p>

          {/* Action row */}
          <div className="flex gap-2 justify-center">
            <Link
              href={`/battle?challenge=${walletAddress}`}
              className="flex-1 max-w-45 px-5 py-3 rounded-xl font-bold text-sm text-center transition-colors"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Swords size={14} /> Challenge
              </span>
            </Link>
            <button
              onClick={copyCardUrl}
              className="flex-1 max-w-45 flex items-center justify-center gap-1.5 px-5 py-3 rounded-xl font-bold text-sm transition-colors"
              style={{ background: 'rgba(234,179,8,0.1)', color: copied ? '#22c55e' : '#eab308', border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : 'rgba(234,179,8,0.25)'}` }}
            >
              {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Share</>}
            </button>
          </div>

          <Link
            href="/"
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            Create your own warrior →
          </Link>
        </motion.div>
      </motion.div>
    </div>
  )
}
