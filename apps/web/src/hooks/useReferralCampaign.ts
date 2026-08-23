import { useQuery } from '@tanstack/react-query'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export interface ReferralCampaignMeta {
  id: string
  name: string
  starts_at: string
  ends_at: string
  active: boolean
  upcoming: boolean
  ended: boolean
}

export interface ReferralLeaderEntry {
  rank: number
  wallet_address: string
  character_name: string | null
  username: string | null
  referral_count: number
}

interface ReferralCampaignResponse {
  campaign: ReferralCampaignMeta | null
  leaderboard: ReferralLeaderEntry[]
}

/** The live referral campaign (or the most recent one) and its ranked board. */
export function useReferralCampaign() {
  return useQuery({
    queryKey: ['referral-campaign-current'],
    queryFn: async (): Promise<ReferralCampaignResponse> => {
      const res = await fetch(`${API}/campaigns/referrals/current`)
      if (!res.ok) return { campaign: null, leaderboard: [] }
      return res.json()
    },
    staleTime: 30_000,
  })
}
