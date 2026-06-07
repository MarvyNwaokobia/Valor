'use client'

import { motion } from 'framer-motion'
import { useRankPool } from '@/hooks/useRankPool'
import { RANK_DEFINITIONS } from '@/lib/ranks'
import type { Rank } from '@/types/database'

interface Props {
  rank: Rank
  walletAddress: `0x${string}`
}

export default function RankPoolPanel({ rank, walletAddress }: Props) {
  const { poolAddress, status, loading, claiming, claimError, claimTxHash, claim } =
    useRankPool(rank, walletAddress)

  const def = RANK_DEFINITIONS[rank]

  // Bronze has no pool — nothing to show
  if (!poolAddress) return null

  return (
    <motion.div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'rgba(4,3,12,0.7)', borderColor: `${def.color}22` }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: `${def.color}18`, background: `${def.color}08` }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: def.color }} />
          <p className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: def.color }}>
            {def.label} Reward Pool
          </p>
        </div>
        <span className="text-[9px] text-slate-600 uppercase tracking-wider font-bold">
          GoodCollective
        </span>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {loading && !status && (
          <p className="text-slate-600 text-xs text-center py-2">Loading pool data...</p>
        )}

        {status && (
          <>
            {/* Member status */}
            {!status.isMember && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500/50 shrink-0" />
                <p className="text-[10px] text-amber-500/70">
                  Enrollment pending — you&apos;ll be added to this pool automatically after your next battle rank-up.
                </p>
              </div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5 px-3 py-2.5 rounded-xl"
                style={{ background: `${def.color}08`, border: `1px solid ${def.color}18` }}>
                <p className="text-[8px] uppercase tracking-widest font-bold" style={{ color: def.color }}>
                  Pending Claim
                </p>
                <p className="font-display font-black text-white text-lg leading-none">
                  {status.claimAmount}
                  <span className="text-[10px] font-bold text-slate-500 ml-1">G$</span>
                </p>
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-2.5 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[8px] uppercase tracking-widest font-bold text-slate-500">
                  Daily Rate
                </p>
                <p className="font-display font-black text-white text-lg leading-none">
                  {status.dailyUbi}
                  <span className="text-[10px] font-bold text-slate-500 ml-1">G$/day</span>
                </p>
              </div>
            </div>

            {/* Next claim time */}
            {status.nextClaimTime && !status.canClaim && (
              <p className="text-[10px] text-slate-600 text-center">
                Next claim available{' '}
                {status.nextClaimTime.toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}

            {/* Claim button */}
            {status.isMember && (
              <motion.button
                onClick={claim}
                disabled={claiming || !status.canClaim}
                whileHover={status.canClaim ? { scale: 1.02, filter: 'brightness(1.1)' } : undefined}
                whileTap={status.canClaim ? { scale: 0.97 } : undefined}
                className="w-full py-3 font-display font-black uppercase text-sm tracking-widest disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-opacity"
                style={{
                  background: status.canClaim
                    ? `linear-gradient(135deg, ${def.color}cc, ${def.color})`
                    : `${def.color}18`,
                  color: status.canClaim ? '#04030c' : def.color,
                  border: `1px solid ${def.color}30`,
                }}
              >
                {claiming ? 'Claiming...' : status.canClaim ? 'Claim G$' : 'Already Claimed'}
              </motion.button>
            )}

            {claimError && (
              <p className="text-red-400 text-[10px] text-center">{claimError}</p>
            )}
            {claimTxHash && (
              <p className="text-green-400 text-[10px] text-center">
                Claimed!{' '}
                <a
                  href={`https://celoscan.io/tx/${claimTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline opacity-70 hover:opacity-100"
                >
                  View tx
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}
