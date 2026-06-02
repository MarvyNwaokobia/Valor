import { Link, useLocation } from 'react-router-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { usePlayerStore } from '@/stores/usePlayerStore'

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/battle', label: 'Battle' },
  { to: '/marketplace', label: 'Market' },
  { to: '/leaderboard', label: 'Ranks' },
]

export default function Navbar() {
  const location = useLocation()
  const player = usePlayerStore((s) => s.player)

  return (
    <nav className="border-b border-valor-border bg-valor-surface/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="font-display font-bold text-xl text-valor-gold tracking-wider">
            VALOR
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  location.pathname === to
                    ? 'text-valor-gold bg-valor-surface-2'
                    : 'text-slate-400 hover:text-white hover:bg-valor-surface-2'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {player && (
            <Link
              to="/profile"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded bg-valor-surface-2 border border-valor-border hover:border-valor-gold/50 transition-colors"
            >
              <span className="text-xs text-slate-400">
                {player.character_name}
              </span>
              <span className="text-xs font-bold text-valor-gold">
                {player.rank}
              </span>
            </Link>
          )}
          <ConnectButton
            accountStatus="avatar"
            chainStatus="icon"
            showBalance={false}
          />
        </div>
      </div>
    </nav>
  )
}
