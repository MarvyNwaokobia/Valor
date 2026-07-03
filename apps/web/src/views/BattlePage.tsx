'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Target, Users, Crosshair, ChevronLeft, ChevronRight } from 'lucide-react'
import { useWeb3Auth } from '@web3auth/modal/react'
import { useWeb3AuthAddress } from '@/hooks/useWeb3AuthAddress'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { CLASS_DEFINITIONS } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'
import CampaignSelect from '@/components/battle/CampaignSelect'
import BattlePvP from '@/components/battle/BattlePvP'
import ChallengeBattle from '@/components/battle/ChallengeBattle'
import LoadingScreen from '@/components/ui/LoadingScreen'

export default function BattlePage() {
  const { isInitialized: ready } = useWeb3Auth()
  const { address, status: addressStatus } = useWeb3AuthAddress()
  const router = useRouter()
  const player = usePlayerStore(s => s.player)
  const playerSynced = usePlayerStore(s => s.playerSynced)
  const searchParams = useSearchParams()
  const challengeTarget = searchParams.get('challenge') ?? undefined

  const [view, setView] = useState<'menu' | 'campaign' | 'pvp' | 'challenge'>(
    challengeTarget ? 'challenge' : 'menu'
  )

  if (!ready) return <LoadingScreen />
  if (addressStatus === 'unauthenticated' || addressStatus === 'failed') { router.replace('/'); return null }
  if (addressStatus === 'resolving' || !address) return <LoadingScreen />
  if (!player && !playerSynced) return <LoadingScreen />
  if (!player) { router.replace('/'); return null }

  const def = CLASS_DEFINITIONS[player.character_class as CharacterClass] ?? CLASS_DEFINITIONS.Berserker

  if (view === 'campaign') {
    return <CampaignSelect player={player} onBack={() => setView('menu')} />
  }

  if (view === 'pvp') {
    return <BattlePvP player={player} walletAddress={address} onBack={() => setView('menu')} />
  }

  if (view === 'challenge') {
    return (
      <div className="max-w-2xl mx-auto">
        <ChallengeBattle
          walletAddress={address}
          onBack={() => setView('menu')}
          prefillOpponent={challengeTarget}
        />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-5 py-2">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <button onClick={() => router.push('/')} className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-3">
          <ChevronLeft size={16} /> Home
        </button>
        <p className="text-[10px] uppercase tracking-[0.3em] font-bold mb-1" style={{ color: def.accentColor }}>
          Battle Arena
        </p>
        <h1 className="font-display font-black text-white text-3xl tracking-wide">Choose Your Fight</h1>
        <p className="text-slate-500 text-sm mt-1">Win = +100 XP · Loss = +30 XP · Every fight counts.</p>
      </motion.div>

      {/* Campaign */}
      <motion.button
        onClick={() => setView('campaign')}
        className="group relative overflow-hidden p-6 rounded-2xl border text-left transition-all"
        style={{ background: 'rgba(8,8,14,0.9)', borderColor: 'rgba(42,42,58,0.8)' }}
        whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
      >
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'radial-gradient(ellipse 80% 80% at 20% 50%, rgba(239,68,68,0.08), transparent)' }} />
        <div className="absolute inset-y-0 left-0 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: '#ef4444' }} />
        <div className="flex items-center gap-5 relative z-10">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <Target size={28} style={{ color: '#ef4444' }} strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-black text-white text-xl group-hover:text-amber-400 transition-colors">Campaign</p>
            <p className="text-slate-500 text-sm mt-0.5">
              Play against bots · 15 levels · Beat each to unlock the next
            </p>
          </div>
          <ChevronRight size={16} className="shrink-0 text-slate-700 group-hover:text-white transition-colors" />
        </div>
      </motion.button>

      {/* Challenge a Player */}
      <motion.button
        onClick={() => setView('challenge')}
        className="group relative overflow-hidden p-6 rounded-2xl border text-left transition-all"
        style={{ background: 'rgba(8,8,14,0.9)', borderColor: 'rgba(42,42,58,0.8)' }}
        whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
      >
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'radial-gradient(ellipse 80% 80% at 20% 50%, rgba(234,179,8,0.07), transparent)' }} />
        <div className="absolute inset-y-0 left-0 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: '#eab308' }} />
        <div className="flex items-center gap-5 relative z-10">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <Crosshair size={28} style={{ color: '#eab308' }} strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-black text-white text-xl group-hover:text-amber-400 transition-colors">Challenge a Player</p>
            <p className="text-slate-500 text-sm mt-0.5">Search by name · Async duel · Share invite link</p>
          </div>
          <ChevronRight size={16} className="shrink-0 text-slate-700 group-hover:text-white transition-colors" />
        </div>
      </motion.button>

      {/* Live PvP */}
      <motion.button
        onClick={() => setView('pvp')}
        className="group relative overflow-hidden p-6 rounded-2xl border text-left transition-all"
        style={{ background: 'rgba(8,8,14,0.9)', borderColor: 'rgba(42,42,58,0.8)' }}
        whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
      >
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'radial-gradient(ellipse 80% 80% at 20% 50%, rgba(59,130,246,0.08), transparent)' }} />
        <div className="absolute inset-y-0 left-0 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: '#3b82f6' }} />
        <div className="flex items-center gap-5 relative z-10">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}>
            <Users size={28} style={{ color: '#3b82f6' }} strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-black text-white text-xl group-hover:text-amber-400 transition-colors">Live PvP</p>
            <p className="text-slate-500 text-sm mt-0.5">Real-time · Fight a live player · Winner takes XP</p>
          </div>
          <ChevronRight size={16} className="shrink-0 text-slate-700 group-hover:text-white transition-colors" />
        </div>
      </motion.button>
    </div>
  )
}
