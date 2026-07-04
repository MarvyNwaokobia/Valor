'use client'

import { useAuthRetry } from '@/hooks/useAuthRetry'

// Shown when Web3Auth reports the user connected but its own provider never
// produces a wallet address after repeated checks (useWalletBridgeGuard) —
// waiting longer won't help here, so this offers the one recovery that does:
// a full disconnect + fresh login attempt.
export default function SignInStalled() {
  const retry = useAuthRetry()

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ background: '#04030c' }}
    >
      <p className="text-white font-display font-black text-xl">Sign-in didn&apos;t finish</p>
      <p className="text-slate-500 text-sm max-w-xs leading-relaxed">
        Your login started but never completed. This can happen with Google, email, or SMS sign-in — try again.
      </p>
      <button
        onClick={() => void retry()}
        className="mt-2 px-6 py-3 rounded-xl font-bold text-sm text-black"
        style={{ background: '#eab308' }}
      >
        Try Again
      </button>
    </div>
  )
}
