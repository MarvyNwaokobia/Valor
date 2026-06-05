import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { DAILY_CLAIM_G } from '@/lib/constants'
import { useValorEngagementRewards } from '@/hooks/useEngagementRewards'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

interface Props {
  walletAddress: string
}

const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000

export default function DailyClaimButton({ walletAddress }: Props) {
  const queryClient = useQueryClient()
  const [claimed, setClaimed] = useState(false)
  const [rewardTxHash, setRewardTxHash] = useState<string | null>(null)

  const { canClaim, claimEngagementReward, isReady: rewardsReady } = useValorEngagementRewards()

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
      await fetch(`${API}/players/${walletAddress}/daily-claim`, {
        method: 'POST',
      })

      // 3. Attempt on-chain engagement reward if eligible
      if (rewardsReady) {
        const eligible = await canClaim(walletAddress as `0x${string}`)
        if (eligible) {
          try {
            const receipt = await claimEngagementReward(walletAddress as `0x${string}`)
            setRewardTxHash(receipt.transactionHash)
          } catch {
            // Non-fatal: daily claim still recorded, on-chain reward failed silently
          }
        }
      }
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
    <div className="bg-valor-surface border border-valor-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-bold text-white text-sm">Daily Bonus</p>
        <span className="text-valor-gold font-bold">+{DAILY_CLAIM_G} Gold</span>
      </div>

      {claimed ? (
        <motion.p
          className="text-green-400 text-sm font-bold text-center"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          Reward claimed! ✓
        </motion.p>
      ) : canClaimDaily ? (
        <button
          onClick={() => mutate()}
          disabled={isPending}
          className="w-full py-2 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light disabled:opacity-50 transition-colors text-sm"
        >
          {isPending ? 'Claiming...' : 'Claim Daily Reward'}
        </button>
      ) : (
        <p className="text-xs text-slate-500 text-center">
          Next claim in {hoursRemaining.toFixed(1)}h
        </p>
      )}
    </div>
  )
}
