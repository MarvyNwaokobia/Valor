import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import type { Player } from '@/types'
import RankBadge from '@/components/player-card/RankBadge'
import { formatGDollarNumber } from '@/utils/format'
import { RANK_COLORS } from '@/lib/constants'

interface Props {
  currentWallet: string | undefined
}

const RANK_ORDER = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze']

function sortLeaderboard(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    const rankDiff = RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank)
    return rankDiff !== 0 ? rankDiff : b.xp - a.xp
  })
}

export default function LeaderboardTable({ currentWallet }: Props) {
  const [players, setPlayers] = useState<Player[]>([])
  const [myPosition, setMyPosition] = useState<number | null>(null)
  const [myPlayer, setMyPlayer] = useState<Player | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedWallet, setUpdatedWallet] = useState<string | null>(null)

  const loadLeaderboard = useCallback(async () => {
    const { data } = await supabase
      .from('players')
      .select('*')

    if (!data) return

    const sorted = sortLeaderboard(data)
    setPlayers(sorted.slice(0, 50))

    if (currentWallet) {
      const pos = sorted.findIndex(
        (p) => p.wallet_address.toLowerCase() === currentWallet.toLowerCase(),
      )
      setMyPosition(pos >= 0 ? pos + 1 : null)
      setMyPlayer(sorted.find((p) => p.wallet_address.toLowerCase() === currentWallet.toLowerCase()) ?? null)
    }

    setLoading(false)
  }, [currentWallet])

  useEffect(() => {
    loadLeaderboard()

    const sub = supabase
      .channel('leaderboard-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'players' },
        (payload) => {
          const updated = payload.new as Player
          setUpdatedWallet(updated.wallet_address)
          setTimeout(() => setUpdatedWallet(null), 1500)
          setPlayers((prev) => {
            const next = prev.map((p) =>
              p.wallet_address === updated.wallet_address ? updated : p,
            )
            return sortLeaderboard(next)
          })
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(sub) }
  }, [loadLeaderboard])

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-16 bg-valor-surface rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* My position banner if outside top 50 */}
      {myPosition && myPosition > 50 && myPlayer && (
        <div className="p-3 bg-valor-gold/10 border border-valor-gold/30 rounded-xl text-sm font-bold text-valor-gold text-center">
          Your position: #{myPosition}
        </div>
      )}

      <AnimatePresence initial={false}>
        {players.map((player, i) => {
          const isMe = player.wallet_address.toLowerCase() === currentWallet?.toLowerCase()
          const pos = i + 1
          const rankColor = RANK_COLORS[player.rank]
          const isUpdating = updatedWallet === player.wallet_address

          return (
            <motion.div
              key={player.wallet_address}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Link
                to={`/card/${player.wallet_address}`}
                className={`flex items-center gap-4 p-3.5 rounded-xl border transition-all hover:bg-valor-surface-2 ${
                  isMe
                    ? 'border-valor-gold/50 bg-valor-gold/5'
                    : isUpdating
                      ? 'border-green-500/40 bg-green-500/5'
                      : 'border-valor-border bg-valor-surface'
                }`}
              >
                {/* Position */}
                <div className="w-9 text-center shrink-0">
                  {pos === 1 ? (
                    <span className="text-xl">🥇</span>
                  ) : pos === 2 ? (
                    <span className="text-xl">🥈</span>
                  ) : pos === 3 ? (
                    <span className="text-xl">🥉</span>
                  ) : (
                    <span className="font-bold text-slate-500 text-sm">#{pos}</span>
                  )}
                </div>

                {/* Avatar */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl border-2 shrink-0"
                  style={{ borderColor: `${rankColor}66` }}
                >
                  {player.avatar}
                </div>

                {/* Name + rank */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-white text-sm truncate">
                      {player.character_name}
                    </p>
                    {isMe && (
                      <span className="text-xs bg-valor-gold text-black px-1.5 py-0.5 rounded font-bold shrink-0">
                        YOU
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <RankBadge rank={player.rank} />
                    <span className="text-xs text-slate-500">{player.xp.toLocaleString()} XP</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="text-right hidden sm:block shrink-0">
                  <p className="text-xs font-bold text-valor-gold">
                    {formatGDollarNumber(player.g_earned_lifetime)}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {player.wins}W / {player.losses}L
                  </p>
                </div>

                {/* XP bar strip */}
                <div className="w-12 shrink-0 hidden md:block">
                  <div className="h-1.5 bg-valor-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(player.xp / 1000) * 100}%`,
                        background: rankColor,
                      }}
                    />
                  </div>
                </div>
              </Link>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
