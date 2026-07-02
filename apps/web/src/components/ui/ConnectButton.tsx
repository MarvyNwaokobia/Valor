import { usePrivy, useLogin, useLogout } from '@privy-io/react-auth'
import { useAccount } from 'wagmi'
import { motion } from 'framer-motion'

export function PrivyConnectButton() {
  const { ready, authenticated } = usePrivy()
  const { login } = useLogin()
  const { logout } = useLogout()
  const { address } = useAccount()

  // Privy not yet initialised — show skeleton to prevent layout shift
  if (!ready) {
    return <div className="w-28 h-9 rounded-xl bg-valor-surface-2 animate-pulse" />
  }

  if (!authenticated) {
    return (
      <motion.button
        onClick={login}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="px-4 py-2 bg-valor-gold text-black font-bold rounded-xl text-sm hover:bg-valor-gold-light transition-colors shadow-[0_0_12px_rgba(234,179,8,0.25)]"
      >
        Enter Valor
      </motion.button>
    )
  }

  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : '—'

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:block text-xs text-slate-400 font-mono bg-valor-surface-2 px-2.5 py-1.5 rounded-lg border border-valor-border">
        {shortAddress}
      </span>
      <button
        onClick={() => logout()}
        className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-valor-surface-2"
      >
        Sign Out
      </button>
    </div>
  )
}
