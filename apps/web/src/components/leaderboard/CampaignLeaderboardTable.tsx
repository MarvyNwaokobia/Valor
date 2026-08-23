'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Clock, Medal, Users } from 'lucide-react'
import { useReferralCampaign } from '@/hooks/useReferralCampaign'

interface Props { currentWallet: string | undefined }

const MEDAL_COLOR = ['#FFD700', '#C0C0C0', '#CD7F32']
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`

function formatCountdown(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now()
  if (diff <= 0) return 'Campaign ended'
  const days = Math.floor(diff / 86_400_000)
  if (days > 0) return `Ends in ${days}d ${Math.floor((diff % 86_400_000) / 3_600_000)}h`
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  return `Ends in ${hours}h ${minutes}m`
}

export default function CampaignLeaderboardTable({ currentWallet }: Props) {
  const { data, isLoading } = useReferralCampaign()
  const campaign = data?.campaign ?? null
  const entries = data?.leaderboard ?? []
  const me = currentWallet?.toLowerCase()
  const myEntry = me ? entries.find(e => e.wallet_address.toLowerCase() === me) : undefined

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'rgba(18,18,26,0.6)' }} />
        ))}
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="p-6 rounded-xl text-center text-slate-500 text-sm"
        style={{ background: 'rgba(8,8,14,0.9)', border: '1px solid rgba(42,42,58,0.6)' }}>
        No referral campaign is running right now.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 p-3 rounded-xl"
        style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}>
        <div className="min-w-0">
          <p className="text-white font-black text-sm truncate">{campaign.name}</p>
          <p className="text-slate-500 text-xs">
            Referrals from {new Date(campaign.starts_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} count toward this board
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-bold shrink-0" style={{ color: campaign.ended ? '#64748b' : '#3b82f6' }}>
          <Clock size={13} />
          {campaign.upcoming
            ? `Starts ${new Date(campaign.starts_at).toLocaleDateString()}`
            : formatCountdown(campaign.ends_at)}
        </div>
      </div>

      {myEntry && (
        <div className="p-3 rounded-xl text-sm font-black text-amber-400 text-center"
          style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)' }}>
          Your position: #{myEntry.rank} · {myEntry.referral_count} referral{myEntry.referral_count === 1 ? '' : 's'}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-6">No referrals yet this campaign — be the first to recruit.</p>
      ) : (
        <AnimatePresence initial={false}>
          {entries.map((e) => {
            const isMe = !!me && e.wallet_address.toLowerCase() === me
            const name = e.character_name || e.username || short(e.wallet_address)
            return (
              <motion.div key={e.wallet_address} layout
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border"
                style={{
                  background: isMe ? 'rgba(234,179,8,0.08)' : 'rgba(8,8,14,0.85)',
                  borderColor: isMe ? 'rgba(234,179,8,0.4)' : 'rgba(42,42,58,0.7)',
                }}
              >
                <div className="w-8 text-center shrink-0">
                  {e.rank <= 3
                    ? <Medal size={18} className="inline" color={MEDAL_COLOR[e.rank - 1]} />
                    : <span className="font-black text-slate-600 text-xs">#{e.rank}</span>}
                </div>

                <Users size={14} className="text-slate-600 shrink-0" />

                <div className="flex-1 min-w-0">
                  <p className="font-black text-white text-sm truncate">
                    {name}
                    {isMe && <span className="ml-1.5 text-[10px] text-amber-400">YOU</span>}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-display font-black text-white text-sm">{e.referral_count}</p>
                  <p className="text-[9px] text-slate-600 uppercase">referrals</p>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      )}
    </div>
  )
}
