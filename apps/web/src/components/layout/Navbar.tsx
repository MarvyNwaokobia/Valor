'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useConnection } from 'wagmi'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { PrivyConnectButton } from '@/components/ui/PrivyConnectButton'
import { useGBalance } from '@/hooks/useGBalance'

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/battle', label: 'Battle' },
  { to: '/marketplace', label: 'Market' },
  { to: '/leaderboard', label: 'Ranks' },
]

export default function Navbar() {
  const pathname = usePathname()
  const player = usePlayerStore((s) => s.player)
  const { address } = useConnection()
  const { formatted: gBalance } = useGBalance(address)

  return (
    <nav className="border-b border-valor-border bg-valor-surface/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-display font-bold text-xl text-valor-gold tracking-wider">
            VALOR
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ to, label }) => (
              <Link
                key={to}
                href={to}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  pathname === to
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
          {/* G$ live balance */}
          {gBalance && (
            <span className="hidden sm:block text-xs font-bold text-valor-gold bg-valor-gold/10 px-2.5 py-1.5 rounded-lg border border-valor-gold/20">
              {gBalance}
            </span>
          )}

          {player && (
            <Link
              href="/profile"
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
          <PrivyConnectButton />
        </div>
      </div>
    </nav>
  )
}
