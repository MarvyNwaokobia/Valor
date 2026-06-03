import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Leaf, Send } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Player, Mission, Item } from '@/types'
import { MISSION_DURATION_MS, XP_IDLE_COLLECT } from '@/lib/constants'
import { formatCountdown } from '@/utils/format'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useAchievements } from '@/hooks/useAchievements'
import { ITEM_RARITY_COLORS } from '@/lib/constants'

interface Props {
  walletAddress: string
  player: Player
}

interface CollectResult {
  item_dropped: string | null
  xp: number
  item?: Item | null
}

export default function IdlePanel({ walletAddress, player }: Props) {
  const queryClient = useQueryClient()
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)
  const addInventoryItem = usePlayerStore((s) => s.addInventoryItem)
  const { checkAchievements } = useAchievements()
  const [timeLeft, setTimeLeft] = useState(0)
  const [lastReward, setLastReward] = useState<CollectResult | null>(null)

  const { data: mission } = useQuery({
    queryKey: ['active-mission', walletAddress],
    queryFn: async () => {
      const { data } = await supabase
        .from('missions')
        .select('*')
        .eq('wallet_address', walletAddress)
        .eq('collected', false)
        .order('deployed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data as Mission | null
    },
    refetchInterval: 10_000,
  })

  useEffect(() => {
    if (!mission) { setTimeLeft(0); return }
    const readyAt = new Date(mission.deployed_at).getTime() + MISSION_DURATION_MS
    const tick = () => setTimeLeft(Math.max(0, readyAt - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [mission])

  const isReady = mission ? timeLeft <= 0 : false

  const { mutate: deploy, isPending: isDeploying } = useMutation({
    mutationFn: async () => {
      const now = new Date()
      const collectBy = new Date(now.getTime() + MISSION_DURATION_MS)
      const { data, error } = await supabase
        .from('missions')
        .insert({
          wallet_address: walletAddress,
          deployed_at: now.toISOString(),
          collect_by: collectBy.toISOString(),
          collected: false,
          item_dropped: null,
          xp_awarded: 0,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-mission', walletAddress] })
    },
  })

  const { mutate: collect, isPending: isCollecting } = useMutation({
    mutationFn: async (): Promise<CollectResult> => {
      if (!mission) throw new Error('No active mission')
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/missions/${mission.id}/collect`,
        { method: 'POST', headers: { 'x-wallet': walletAddress } },
      )
      if (!res.ok) throw new Error('Collection failed')
      return res.json() as Promise<CollectResult>
    },
    onSuccess: async (data) => {
      setLastReward(data)

      // Fetch dropped item details if any
      if (data.item_dropped) {
        const { data: item } = await supabase
          .from('items')
          .select('*')
          .eq('id', data.item_dropped)
          .single()

        if (item) {
          addInventoryItem({
            wallet_address: walletAddress,
            item_id: item.id,
            equipped: false,
            acquired_at: new Date().toISOString(),
          })
          setLastReward({ ...data, item })
        }
      }

      updatePlayer({
        xp: Math.min(999, player.xp + data.xp),
        last_active: new Date().toISOString(),
        decay_status: 'none',
      })

      queryClient.invalidateQueries({ queryKey: ['active-mission', walletAddress] })

      // Check achievements — missions >= 10, inventory >= 5, etc.
      checkAchievements(walletAddress).catch(console.error)

      // Auto-dismiss reward after 5s
      setTimeout(() => setLastReward(null), 5000)
    },
  })

  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-white">Idle Mission</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Deploy · Wait 30 min · Collect XP + item
          </p>
        </div>
        <Leaf size={22} className="text-green-500" strokeWidth={1.5} />
      </div>

      {/* Reward notification */}
      <AnimatePresence>
        {lastReward && (
          <motion.div
            className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-xl"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <p className="text-green-400 font-bold text-sm">Mission complete!</p>
            <p className="text-xs text-slate-400 mt-1">
              +{lastReward.xp} XP
              {lastReward.item && (
                <>
                  {' '}·{' '}
                  <span
                    style={{ color: ITEM_RARITY_COLORS[lastReward.item.rarity] }}
                    className="font-bold"
                  >
                    {lastReward.item.name}
                  </span>
                  {' '}dropped!
                </>
              )}
              {!lastReward.item_dropped && !lastReward.item && ' · No item drop this time.'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {!mission ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-400 leading-relaxed">
            Send your character on a 30-minute idle mission. Returns with{' '}
            <span className="text-white font-bold">+{XP_IDLE_COLLECT} XP</span> and a random item
            drop from the loot table.
          </p>
          <div className="grid grid-cols-4 gap-2 text-center text-xs text-slate-500">
            {[['60%', 'Common Wep'], ['25%', 'Common Shield'], ['10%', 'Rare Wep'], ['5%', 'Rare Shield']].map(([pct, label]) => (
              <div key={label} className="bg-valor-surface-2 rounded-lg py-2 px-1">
                <p className="text-white font-bold">{pct}</p>
                <p className="mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          <motion.button
            onClick={() => deploy()}
            disabled={isDeploying}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light disabled:opacity-50 transition-colors text-sm"
          >
            {isDeploying ? 'Deploying...' : (
              <span className="flex items-center justify-center gap-1.5">
                <Send size={13} /> Deploy on Mission
              </span>
            )}
          </motion.button>
        </div>
      ) : isReady ? (
        <div className="flex flex-col gap-3">
          <motion.div
            className="flex items-center gap-2 text-green-400 font-bold"
            animate={{ opacity: [1, 0.6, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <span>✦</span>
            <span className="text-sm">Mission complete — collect your rewards!</span>
          </motion.div>
          <motion.button
            onClick={() => collect()}
            disabled={isCollecting}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 bg-green-500 text-white font-bold rounded-lg hover:bg-green-400 disabled:opacity-50 transition-colors text-sm"
          >
            {isCollecting ? 'Collecting...' : `Collect (+${XP_IDLE_COLLECT} XP)`}
          </motion.button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">Character on mission...</p>
            <div className="flex items-center gap-1.5">
              <motion.div
                className="w-2 h-2 rounded-full bg-valor-gold"
                animate={{ scale: [1, 1.5, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
              <span className="font-mono font-bold text-valor-gold">
                {formatCountdown(timeLeft)}
              </span>
            </div>
          </div>
          <div className="h-2 bg-valor-surface-2 rounded-full overflow-hidden border border-valor-border/50">
            <motion.div
              className="h-full bg-valor-gold rounded-full"
              style={{
                width: `${100 - (timeLeft / MISSION_DURATION_MS) * 100}%`,
              }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
