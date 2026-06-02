import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Player } from '@/types'
import RankBadge from '@/components/player-card/RankBadge'
import { formatGDollarNumber } from '@/utils/format'
import { Link } from 'react-router-dom'

interface Props {
  currentWallet: string | undefined
}

const RANK_ORDER = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze']

export default function LeaderboardTable({ currentWallet }: Props) {
  const [players, setPlayers] = useState<Player[]>([])
  const [myPosition, setMyPosition] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('players')
        .select('*')
        .order('xp', { ascending: false })

      if (!data) return

      const sorted = [...data].sort((a, b) => {
        const rankDiff = RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank)
        return rankDiff !== 0 ? rankDiff : b.xp - a.xp
      })

      setPlayers(sorted.slice(0, 50))

      if (currentWallet) {
        const pos = sorted.findIndex((p) => p.wallet_address === currentWallet)
        setMyPosition(pos >= 0 ? pos + 1 : null)
      }

      setLoading(false)
    }

    load()

    const sub = supabase
      .channel('leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, load)
      .subscribe()

    return () => { sub.unsubscribe() }
  }, [currentWallet])

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-14 bg-valor-surface rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {myPosition && myPosition > 50 && (
        <div className="p-3 bg-valor-gold/10 border border-valor-gold/30 rounded-xl text-center text-sm text-valor-gold font-bold">
          Your rank: #{myPosition}
        </div>
      )}

      {players.map((player, i) => {
        const isMe = player.wallet_address === currentWallet
        const pos = i + 1

        return (
          <Link
            key={player.wallet_address}
            to={`/card/${player.wallet_address}`}
            className={`flex items-center gap-4 p-3 rounded-xl border transition-colors hover:bg-valor-surface-2 ${
              isMe
                ? 'border-valor-gold/60 bg-valor-gold/5'
                : 'border-valor-border bg-valor-surface'
            }`}
          >
            <span
              className={`w-8 text-center font-bold text-sm ${
                pos <= 3 ? 'text-valor-gold' : 'text-slate-500'
              }`}
            >
              {pos <= 3 ? ['🥇', '🥈', '🥉'][pos - 1] : `#${pos}`}
            </span>

            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-lg border border-valor-border"
            >
              {player.avatar}
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-sm truncate">{player.character_name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <RankBadge rank={player.rank} />
                <span className="text-xs text-slate-500">{player.xp.toLocaleString()} XP</span>
              </div>
            </div>

            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-valor-gold">{formatGDollarNumber(player.g_earned_lifetime)}</p>
              <p className="text-xs text-slate-500 mt-0.5">{player.wins}W / {player.losses}L</p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
