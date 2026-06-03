import Link from 'next/link'
import { motion } from 'framer-motion'
import { useConnection } from 'wagmi'
import { Swords, ShoppingBag, Trophy, Leaf, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { usePlayerStore } from '@/stores/usePlayerStore'
import PlayerCard from '@/components/player-card/PlayerCard'
import XpMeter from '@/components/player-card/XpMeter'
import LandingPage from '@/components/landing/LandingPage'
import { RANK_G_REWARD, XP_PER_RANK } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'
import { useLogin } from '@privy-io/react-auth'

export default function HomePage() {
  const { address } = useConnection()
  const player = usePlayerStore((s) => s.player)

  if (!address) return <LandingPage />
  if (!player) return <OnboardingPrompt />

  const nextRankReward = RANK_G_REWARD[player.rank]
  const xpToNextRank = XP_PER_RANK - player.xp

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Sticky player card */}
      <div className="lg:sticky lg:top-24 w-full lg:w-80 shrink-0 flex flex-col gap-4">
        <PlayerCard player={player} showShareLink />

        {/* Next rank reward teaser */}
        <div className="bg-valor-surface border border-valor-border rounded-xl p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-2">
            Next Rank Reward
          </p>
          <div className="flex items-center justify-between">
            <span className="text-valor-gold font-bold text-lg">
              {formatGDollarNumber(nextRankReward)}
            </span>
            <span className="text-xs text-slate-500">{xpToNextRank.toLocaleString()} XP away</span>
          </div>
          <XpMeter xp={player.xp} max={XP_PER_RANK} rank={player.rank} />
        </div>
      </div>

      {/* Dashboard */}
      <div className="flex-1 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {ACTIONS.map(({ to, Icon, label, desc }) => (
            <Link
              key={to}
              href={to}
              className="flex flex-col gap-3 p-5 bg-valor-surface border border-valor-border rounded-xl hover:border-valor-gold/50 hover:bg-valor-surface-2 transition-all group"
            >
              <Icon
                size={28}
                className="text-slate-400 group-hover:text-valor-gold transition-colors"
                strokeWidth={1.5}
              />
              <div>
                <p className="font-bold text-white group-hover:text-valor-gold transition-colors">
                  {label}
                </p>
                <p className="text-sm text-slate-500 mt-0.5">{desc}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Idle prompt for Wanderers/Champions */}
        {(player.play_style === 'Wanderer' || player.play_style === 'Champion') && (
          <Link
            href="/profile"
            className="flex items-center gap-4 p-5 bg-valor-surface border border-green-800/40 rounded-xl hover:border-green-600/60 transition-all group"
          >
            <Leaf size={28} className="text-green-600 group-hover:text-green-400 transition-colors shrink-0" strokeWidth={1.5} />
            <div className="flex-1">
              <p className="font-bold text-white group-hover:text-green-400 transition-colors">
                Idle Mission
              </p>
              <p className="text-sm text-slate-500">
                Deploy your character for 30 min and collect XP + item drops.
              </p>
            </div>
            <ChevronRight size={16} className="text-slate-500 group-hover:text-white transition-colors" />
          </Link>
        )}
      </div>
    </div>
  )
}

const ACTIONS: { to: string; Icon: LucideIcon; label: string; desc: string }[] = [
  { to: '/battle',      Icon: Swords,      label: 'Battle',      desc: 'Fight bots and challengers for XP' },
  { to: '/marketplace', Icon: ShoppingBag, label: 'Marketplace', desc: 'Buy weapons, shields, boosters'    },
  { to: '/leaderboard', Icon: Trophy,      label: 'Leaderboard', desc: 'Top 50 warriors by rank'           },
]

function OnboardingPrompt() {
  const { login } = useLogin()

  return (
    <section className="flex flex-col items-center text-center gap-6 py-16">
      <motion.div
        className="w-20 h-20 rounded-full bg-valor-gold/20 flex items-center justify-center border-2 border-valor-gold/50"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <Swords size={36} className="text-valor-gold" strokeWidth={1.5} />
      </motion.div>
      <h2 className="text-3xl font-display font-bold text-white">Create Your Character</h2>
      <p className="text-slate-400 max-w-md leading-relaxed">
        Build your hero, climb the ranks, and earn real rewards — one character per player,
        no duplicates.
      </p>
      <Link
        href="/onboarding"
        className="px-10 py-3.5 bg-valor-gold text-black font-bold rounded-xl hover:bg-valor-gold-light transition-colors text-base"
      >
        Create Character
      </Link>
      <button
        onClick={() => login()}
        className="text-sm text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2"
      >
        Switch account
      </button>
    </section>
  )
}
