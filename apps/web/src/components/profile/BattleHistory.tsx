'use client'

import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Swords, Bot, ExternalLink } from 'lucide-react'
import { formatGDollarNumber } from '@/utils/format'
import { RANK_G_REWARD } from '@/lib/constants'
import type { Rank } from '@/lib/constants'
import { ChainBadge } from '@/components/ui/ChainBadge'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

interface BattleRow {
  id: string
  challenger_wallet: string
  opponent_wallet: string
  winner_wallet: string
  xp_awarded_challenger: number
  xp_awarded_opponent: number
  is_bot: boolean
  created_at: string
  game_record_tx: string | null
}

interface Props {
  walletAddress: string
  playerRank: Rank
}

function shortAddr(addr: string) {
  if (addr === 'bot') return 'Bot'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function timeAgo(iso: string) {
  const ms   = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function BattleHistory({ walletAddress, playerRank }: Props) {
  const { data: battles = [], isLoading, isError } = useQuery<BattleRow[]>({
    queryKey: ['battles', walletAddress],
    queryFn: async () => {
      const res = await fetch(`${API}/players/${walletAddress}/battles`)
      if (!res.ok) throw new Error(`${res.status}`)
      return res.json()
    },
    staleTime: 60_000,
    retry: 1,
  })

  const gPerWin = RANK_G_REWARD[playerRank] ?? 10

  if (isLoading) {
    return (
      <div className="bg-valor-surface border border-valor-border rounded-xl p-5">
        <h3 className="font-display font-bold text-white mb-4">Battle History</h3>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: 'rgba(18,18,26,0.6)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="bg-valor-surface border border-valor-border rounded-xl p-6 text-center">
        <Swords size={28} className="text-red-800 mx-auto mb-2" strokeWidth={1.2} />
        <p className="text-slate-500 text-sm">Could not load battle history.</p>
      </div>
    )
  }

  if (battles.length === 0) {
    return (
      <div className="bg-valor-surface border border-valor-border rounded-xl p-6 text-center">
        <Swords size={28} className="text-slate-600 mx-auto mb-2" strokeWidth={1.2} />
        <p className="text-slate-500 text-sm">No battles yet. Hit the arena.</p>
      </div>
    )
  }

  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-bold text-white">Battle History</h3>
        <span className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">Last 10</span>
      </div>

      <div className="flex flex-col gap-2">
        {battles.map((battle, i) => {
          const isChallenger = battle.challenger_wallet.toLowerCase() === walletAddress.toLowerCase()
          const won          = battle.winner_wallet.toLowerCase() === walletAddress.toLowerCase()
          const opponent     = isChallenger ? battle.opponent_wallet : battle.challenger_wallet
          const xpEarned     = isChallenger ? battle.xp_awarded_challenger : battle.xp_awarded_opponent
          const gEarned      = won ? gPerWin : 0

          return (
            <motion.div
              key={battle.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
              style={{
                background:   won ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.04)',
                borderColor:  won ? 'rgba(34,197,94,0.2)'  : 'rgba(239,68,68,0.15)',
              }}
            >
              {/* Win/loss indicator */}
              <div
                className="w-1 h-8 rounded-full shrink-0"
                style={{ background: won ? '#22c55e' : '#ef4444' }}
              />

              {/* Opponent */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {battle.is_bot && <Bot size={10} className="text-slate-500 shrink-0" />}
                  <p className="text-xs font-bold text-white truncate">{shortAddr(opponent)}</p>
                  <span
                    className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-sm shrink-0"
                    style={{
                      background: won ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color:       won ? '#22c55e'             : '#ef4444',
                    }}
                  >
                    {won ? 'WIN' : 'LOSS'}
                  </span>
                </div>
                <p className="text-[9px] text-slate-600 mt-0.5">{timeAgo(battle.created_at)}</p>
              </div>

              {/* Rewards */}
              <div className="text-right shrink-0">
                <p className="text-xs font-black" style={{ color: won ? '#22c55e' : '#64748b' }}>
                  +{xpEarned} XP
                </p>
                {gEarned > 0 && (
                  <p className="text-[10px] font-bold text-amber-400">
                    +{formatGDollarNumber(gEarned)} G$
                  </p>
                )}
              </div>

              {/* On-chain record badge */}
              {battle.game_record_tx && (
                <ChainBadge txHash={battle.game_record_tx} className="shrink-0" />
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Lifetime G$ summary */}
      <div className="mt-4 pt-4 border-t border-valor-border flex items-center justify-between">
        <p className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">
          From {battles.filter(b => b.winner_wallet.toLowerCase() === walletAddress.toLowerCase()).length} wins
        </p>
        <a
          href={`https://celoscan.io/address/${walletAddress}#tokentxns`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-amber-400 transition-colors"
        >
          View on Celoscan <ExternalLink size={9} />
        </a>
      </div>
    </div>
  )
}
