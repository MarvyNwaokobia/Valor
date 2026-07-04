import { useWeb3Auth, useWeb3AuthDisconnect } from '@web3auth/modal/react'
import { motion } from 'framer-motion'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useAuthRetry } from '@/hooks/useAuthRetry'

// `useWeb3Auth().web3Auth` is typed as the base `Web3AuthNoModal`, but
// `Web3AuthProvider` always constructs the modal-capable `Web3Auth` subclass
// under the hood, which adds a zero-arg `connect()` that opens the full login
// modal (email/wallet/Google) — not exposed in the public types.
interface ModalCapableWeb3Auth {
  connect(): Promise<unknown>
}

export function ConnectButton() {
  const { web3Auth } = useWeb3Auth()
  const { disconnect: web3authDisconnect } = useWeb3AuthDisconnect()
  const { status, address } = useResolvedAuth()
  const retry = useAuthRetry()

  // Web3Auth not yet initialised — show skeleton to prevent layout shift
  if (status === 'initializing') {
    return <div className="w-28 h-9 rounded-xl bg-valor-surface-2 animate-pulse" />
  }

  if (status === 'unauthenticated') {
    const login = () => (web3Auth as unknown as ModalCapableWeb3Auth)?.connect()
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

  // Web3Auth's own session never produced a wallet address after retries —
  // waiting longer won't help; only a fresh login attempt will.
  if (status === 'stalled') {
    return (
      <button
        onClick={() => void retry()}
        className="px-3 py-2 rounded-xl border border-red-500/50 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors"
      >
        Sign-in stuck — Retry
      </button>
    )
  }

  // Connected but the address is still resolving (brief — MPC-derived
  // wallets aren't instant). useWalletBridgeGuard is checking in the
  // background; this just reflects that honestly instead of showing a
  // broken "signed in" state with no address.
  if (status === 'resolving' || !address) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-valor-surface-2 text-xs text-slate-400">
        <span className="h-3 w-3 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />
        Finishing sign-in…
      </div>
    )
  }

  const shortAddress = `${address.slice(0, 6)}…${address.slice(-4)}`

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:block text-xs text-slate-400 font-mono bg-valor-surface-2 px-2.5 py-1.5 rounded-lg border border-valor-border">
        {shortAddress}
      </span>
      <button
        onClick={() => void web3authDisconnect({ cleanup: true })}
        className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-valor-surface-2"
      >
        Sign Out
      </button>
    </div>
  )
}
