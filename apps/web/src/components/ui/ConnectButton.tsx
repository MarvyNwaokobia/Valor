import { useDisconnect } from 'wagmi'
import { useWeb3Auth } from '@web3auth/modal/react'
import { useWeb3AuthAddress } from '@/hooks/useWeb3AuthAddress'
import { motion } from 'framer-motion'

// `useWeb3Auth().web3Auth` is typed as the base `Web3AuthNoModal`, but
// `Web3AuthProvider` always constructs the modal-capable `Web3Auth` subclass
// under the hood, which adds a zero-arg `connect()` that opens the full login
// modal (email/wallet/Google) — not exposed in the public types.
interface ModalCapableWeb3Auth {
  connect(): Promise<unknown>
}

export function ConnectButton() {
  const { isInitialized: ready, web3Auth } = useWeb3Auth()
  const { disconnect: logout } = useDisconnect()
  const { address, status: addressStatus } = useWeb3AuthAddress()

  // Web3Auth not yet initialised, or connected but the address hasn't
  // arrived yet (social-login MPC derivation can lag the connect event) —
  // show skeleton instead of a stale "Enter Valor" / "—" button.
  if (!ready || addressStatus === 'resolving') {
    return <div className="w-28 h-9 rounded-xl bg-valor-surface-2 animate-pulse" />
  }

  if (addressStatus === 'unauthenticated' || addressStatus === 'failed') {
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
