'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Swords, User, ShoppingBag, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useConnection } from 'wagmi'

const NAV_ITEMS: { to: string; Icon: LucideIcon; label: string; exact: boolean }[] = [
  { to: '/',            Icon: Home,        label: 'Home',    exact: true  },
  { to: '/battle',      Icon: Swords,      label: 'Battle',  exact: false },
  { to: '/profile',     Icon: User,        label: 'Profile', exact: false },
  { to: '/marketplace', Icon: ShoppingBag, label: 'Market',  exact: false },
  { to: '/leaderboard', Icon: Trophy,      label: 'Ranks',   exact: false },
]

export default function MobileNav() {
  const { address } = useConnection()
  const pathname = usePathname()

  if (!address) return null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-valor-surface/95 backdrop-blur-sm border-t border-valor-border safe-area-pb">
      <div className="flex items-center justify-around h-14">
        {NAV_ITEMS.map(({ to, Icon, label, exact }) => {
          const isActive = exact ? pathname === to : !!pathname?.startsWith(to)
          return (
            <Link
              key={to}
              href={to}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${
                isActive ? 'text-valor-gold' : 'text-slate-500'
              }`}
            >
              <Icon
                size={20}
                className={`transition-transform ${isActive ? 'scale-110' : ''}`}
                strokeWidth={isActive ? 2.5 : 1.8}
              />
              <span className="text-xs font-bold leading-none">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
