import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { DAILY_CLAIM_G } from '@/lib/constants'

interface Props {
  walletAddress: string
}

const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000

export default function DailyClaimButton({ walletAddress }: Props) {
  const queryClient = useQueryClient()
  const [claimed, setClaimed] = useState(false)

  const { data: claim } = useQuery({
    queryKey: ['daily-claim', walletAddress],
    queryFn: async () => {
      const { data } = await supabase
        .from('daily_claims')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single()
      return data
    },
  })

  const canClaim =
    !claim ||
    Date.now() - new Date(claim.last_claimed_at).getTime() >= CLAIM_COOLDOWN_MS

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString()
      await supabase.from('daily_claims').upsert({
        wallet_address: walletAddress,
        last_claimed_at: now,
      })
      // Backend handles actual G$ distribution and activity timestamp update
      await fetch(`${import.meta.env.VITE_API_URL}/players/${walletAddress}/daily-claim`, {
        method: 'POST',
      })
    },
    onSuccess: () => {
      setClaimed(true)
      queryClient.invalidateQueries({ queryKey: ['daily-claim', walletAddress] })
    },
  })

  const hoursRemaining = claim
    ? Math.max(0, CLAIM_COOLDOWN_MS - (Date.now() - new Date(claim.last_claimed_at).getTime())) /
      (1000 * 60 * 60)
    : 0

  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-bold text-white text-sm">Daily Bonus</p>
        <span className="text-valor-gold font-bold">{DAILY_CLAIM_G} G$</span>
      </div>

      {claimed ? (
        <motion.p
          className="text-green-400 text-sm font-bold text-center"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          Claimed! ✓
        </motion.p>
      ) : canClaim ? (
        <button
          onClick={() => mutate()}
          disabled={isPending}
          className="w-full py-2 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light disabled:opacity-50 transition-colors text-sm"
        >
          {isPending ? 'Claiming...' : 'Claim Daily G$'}
        </button>
      ) : (
        <p className="text-xs text-slate-500 text-center">
          Next claim in {hoursRemaining.toFixed(1)}h
        </p>
      )}
    </div>
  )
}
