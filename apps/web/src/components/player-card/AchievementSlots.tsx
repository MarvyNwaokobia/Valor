import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Achievement } from '@/types'

interface Props {
  walletAddress: string
}

export default function AchievementSlots({ walletAddress }: Props) {
  const { data: unlocked = [] } = useQuery({
    queryKey: ['achievements', walletAddress],
    queryFn: async () => {
      const { data } = await supabase
        .from('player_achievements')
        .select('achievement_id, achievements(name, image_url)')
        .eq('wallet_address', walletAddress)
        .limit(6)
      return data ?? []
    },
    staleTime: 60_000,
  })

  const slots = Array.from({ length: 6 })

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider font-bold">
        Achievements
      </p>
      <div className="grid grid-cols-6 gap-1.5">
        {slots.map((_, i) => {
          const achievement = unlocked[i] as
            | { achievement_id: string; achievements: Achievement | null }
            | undefined

          return (
            <div
              key={i}
              className={`aspect-square rounded-lg flex items-center justify-center text-sm border ${
                achievement
                  ? 'bg-valor-gold/10 border-valor-gold/40'
                  : 'bg-valor-surface-2 border-valor-border/50'
              }`}
              title={achievement?.achievements?.name ?? 'Locked'}
            >
              {achievement?.achievements?.image_url ? (
                <img
                  src={achievement.achievements.image_url}
                  alt={achievement.achievements.name}
                  className="w-4 h-4 object-contain"
                />
              ) : achievement ? (
                '★'
              ) : (
                <span className="text-slate-700 text-xs">·</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
