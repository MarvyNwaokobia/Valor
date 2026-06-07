'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { useGBalance } from '@/hooks/useGBalance'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

interface Props {
  walletAddress: string
}

export default function DailyClaimButton({ walletAddress }: Props) {
  const queryClient = useQueryClient()
  const [claimed, setClaimed] = useState(false)

  const { formatted: gBalance } = useGBalance(walletAddress as `0x${string}`)

  const { data: claimStatus } = useQuery({
    queryKey: ['daily-claim', walletAddress],
    queryFn: async () => {
      const res = await fetch(`${API}/players/${walletAddress}/daily-claim-status`)
      if (!res.ok) return null
      return res.json() as Promise<{ can_claim: boolean; last_claimed_at?: string; next_claim_at?: string }>
    },
  })

  const canClaimDaily = claimStatus?.can_claim ?? true

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      await fetch(`${API}/players/${walletAddress}/daily-claim`, { method: 'POST' })
    },
    onSuccess: () => {
      setClaimed(true)
      queryClient.invalidateQueries({ queryKey: ['daily-claim', walletAddress] })
    },
  })

  const hoursRemaining = claimStatus?.next_claim_at
    ? Math.max(0, new Date(claimStatus.next_claim_at).getTime() - Date.now()) / (1000 * 60 * 60)
    : 0

  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-4 flex flex-col gap-3">

      {/* Header + balance */}
      <div className="flex items-center justify-between">
        <p className="font-bold text-white text-sm">Daily Check-in</p>
        {gBalance ? (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded"
            style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <span className="text-[9px] font-bold text-amber-500/60 uppercase tracking-wider">Balance</span>
            <span className="text-xs font-black text-amber-400">{gBalance}</span>
          </div>
        ) : (
          <span className="text-slate-600 text-xs font-bold">Resets Decay</span>
        )}
      </div>

      {claimed ? (
        <motion.p
          className="text-green-400 text-sm font-bold text-center"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          Checked in! Decay reset ✓
        </motion.p>
      ) : canClaimDaily ? (
        <button
          onClick={() => mutate()}
          disabled={isPending}
          className="w-full py-2 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light disabled:opacity-50 transition-colors text-sm"
        >
          {isPending ? 'Checking in...' : 'Daily Check-in'}
        </button>
      ) : (
        <p className="text-xs text-slate-500 text-center">
          Next check-in in {hoursRemaining.toFixed(1)}h
        </p>
      )}
    </div>
  )
}
