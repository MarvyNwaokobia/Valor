import { NavLink } from 'react-router-dom'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useConnection } from 'wagmi'

const NAV_ITEMS = [
  { to: '/', icon: '🏠', label: 'Home', exact: true },
  { to: '/battle', icon: '⚔️', label: 'Battle', exact: false },
  { to: '/profile', icon: '👤', label: 'Profile', exact: false },
  { to: '/marketplace', icon: '🛒', label: 'Market', exact: false },
  { to: '/leaderboard', icon: '🏆', label: 'Ranks', exact: false },
]

export default function MobileNav() {
  const { address } = useConnection()
  const player = usePlayerStore((s) => s.player)

  if (!address) return null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-valor-surface/95 backdrop-blur-sm border-t border-valor-border safe-area-pb">
      <div className="flex items-center justify-around h-14">
        {NAV_ITEMS.map(({ to, icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${
                isActive ? 'text-valor-gold' : 'text-slate-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`text-lg transition-transform ${isActive ? 'scale-110' : ''}`}>
                  {icon}
                </span>
                <span className="text-xs font-bold leading-none">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
