import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useConnection } from 'wagmi'
import { usePlayerStore } from '@/stores/usePlayerStore'
import PlayerCard from '@/components/player-card/PlayerCard'

export default function HomePage() {
  const { address } = useConnection()
  const player = usePlayerStore((s) => s.player)

  return (
    <div className="flex flex-col gap-12">
      {/* Hero */}
      {!address ? (
        <HeroSection />
      ) : !player ? (
        <OnboardingPrompt />
      ) : (
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          <div className="lg:sticky lg:top-24 w-full lg:w-80 shrink-0">
            <PlayerCard player={player} />
          </div>
          <DashboardActions />
        </div>
      )}
    </div>
  )
}

function HeroSection() {
  return (
    <section className="flex flex-col items-center text-center gap-8 py-20">
      <motion.h1
        className="text-5xl md:text-7xl font-display font-bold text-valor-gold"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        VALOR
      </motion.h1>
      <motion.p
        className="text-xl md:text-2xl text-slate-300 max-w-2xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
      >
        Play. Earn real G$. Own everything.
      </motion.p>
      <motion.p
        className="text-slate-500 max-w-lg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        One verified human. One character. Every battle earns you real GoodDollar tokens on Celo.
        Stop playing and your character decays. Stay active and rise through the ranks.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.45 }}
      >
        <p className="text-sm text-slate-400">Connect your wallet above to begin</p>
      </motion.div>
    </section>
  )
}

function OnboardingPrompt() {
  return (
    <section className="flex flex-col items-center text-center gap-6 py-16">
      <h2 className="text-3xl font-display font-bold text-white">Create Your Character</h2>
      <p className="text-slate-400 max-w-md">
        Verify your identity with GoodDollar to create your character and start earning G$.
      </p>
      <Link
        to="/onboarding"
        className="px-8 py-3 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light transition-colors"
      >
        Begin
      </Link>
    </section>
  )
}

function DashboardActions() {
  const actions = [
    { to: '/battle', icon: '⚔️', label: 'Battle', desc: 'Fight opponents, earn XP and G$' },
    { to: '/marketplace', icon: '🛒', label: 'Marketplace', desc: 'Buy weapons, shields, boosters' },
    { to: '/leaderboard', icon: '🏆', label: 'Leaderboard', desc: 'See the top warriors' },
  ]

  return (
    <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
      {actions.map(({ to, icon, label, desc }) => (
        <Link
          key={to}
          to={to}
          className="flex flex-col gap-3 p-6 bg-valor-surface border border-valor-border rounded-xl hover:border-valor-gold/50 transition-colors group"
        >
          <span className="text-3xl">{icon}</span>
          <div>
            <p className="font-bold text-white group-hover:text-valor-gold transition-colors">
              {label}
            </p>
            <p className="text-sm text-slate-500 mt-0.5">{desc}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}
