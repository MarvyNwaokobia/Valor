import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Player, Mission } from '@/types'
import { MISSION_DURATION_MS, XP_IDLE_COLLECT } from '@/lib/constants'
import { formatCountdown } from '@/utils/format'
import { usePlayerStore } from '@/stores/usePlayerStore'

interface Props {
  walletAddress: string
  player: Player
}

export default function IdlePanel({ walletAddress, player }: Props) {
  const queryClient = useQueryClient()
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)
  const addInventoryItem = usePlayerStore((s) => s.addInventoryItem)
  const [timeLeft, setTimeLeft] = useState(0)

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
        .single()
      return data as Mission | null
    },
  })

  useEffect(() => {
    if (!mission) return
    const collectAt = new Date(mission.deployed_at).getTime() + MISSION_DURATION_MS
    const update = () => setTimeLeft(Math.max(0, collectAt - Date.now()))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [mission])

  const isReady = mission ? timeLeft <= 0 : false

  const { mutate: deployMission, isPending: isDeploying } = useMutation({
    mutationFn: async () => {
      const now = new Date()
      const collectBy = new Date(now.getTime() + 48 * 60 * 60 * 1000)
      const { data } = await supabase
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
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['active-mission', walletAddress] }),
  })

  const { mutate: collectMission, isPending: isCollecting } = useMutation({
    mutationFn: async () => {
      if (!mission) return null
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/missions/${mission.id}/collect`,
        { method: 'POST', headers: { 'x-wallet': walletAddress } },
      )
      return res.json() as Promise<{ item_dropped: string | null; xp: number }>
    },
    onSuccess: (data) => {
      if (!data) return
      updatePlayer({ xp: Math.min(999, player.xp + data.xp), last_active: new Date().toISOString() })
      queryClient.invalidateQueries({ queryKey: ['active-mission', walletAddress] })
    },
  })

  return (
    <div className="bg-valor-surface border border-valor-border rounded-xl p-5">
      <h3 className="font-display font-bold text-white mb-4">Idle Mission</h3>

      {!mission ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-400">
            Deploy your character on a 30-minute mission. Returns with XP and a random item.
          </p>
          <motion.button
            onClick={() => deployMission()}
            disabled={isDeploying}
            className="px-6 py-2.5 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light disabled:opacity-50 transition-colors text-sm"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isDeploying ? 'Deploying...' : 'Deploy on Mission'}
          </motion.button>
        </div>
      ) : isReady ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-green-400 font-bold">Mission complete! Collect your rewards.</p>
          <p className="text-xs text-slate-400">+{XP_IDLE_COLLECT} XP + random item drop</p>
          <motion.button
            onClick={() => collectMission()}
            disabled={isCollecting}
            className="px-6 py-2.5 bg-green-500 text-white font-bold rounded-lg hover:bg-green-400 disabled:opacity-50 transition-colors text-sm"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isCollecting ? 'Collecting...' : 'Collect Rewards'}
          </motion.button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-400">Character on mission...</p>
          <div className="flex items-center gap-2">
            <motion.div
              className="w-2 h-2 rounded-full bg-valor-gold"
              animate={{ scale: [1, 1.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="font-mono text-valor-gold font-bold text-lg">
              {formatCountdown(timeLeft)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
