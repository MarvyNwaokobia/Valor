'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useWeb3AuthWallet } from '@/components/providers/Web3AuthSessionProvider'
import { useSignerReady } from '@/hooks/useSignerReady'
import { useSignOut } from '@/hooks/useSignOut'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'
import { useSignerDiagnostic } from '@/hooks/useSignerDiagnostic'

// Shown wherever money can be spent, when the session cannot sign.
//
// The point is to say this BEFORE a player commits to a purchase or a transfer,
// rather than letting them pick an item, confirm it, and hit "Wallet not
// connected" — an error that names no cause and offers no way out. It states
// what is wrong, why, and the one action that fixes it.
export default function SignerWarning({ action = 'buy or transfer' }: { action?: string }) {
  const { signedIn, canSign } = useSignerReady()
  const { source } = useResolvedAuth()
  const signOut = useSignOut()
  const router = useRouter()

  const { connect: connectWallet, isReady: web3authReady } = useWeb3AuthWallet()
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)

  // Report which branch actually failed, so the next occurrence arrives as facts
  // rather than a screenshot to reason backwards from.
  useSignerDiagnostic(canSign)

  async function handleReconnect() {
    if (reconnecting) return
    setReconnecting(true)
    setReconnectError(null)
    try {
      // Web3Auth's chooser carries WalletConnect v2, which is the only transport
      // that reaches a wallet app from a mobile browser now that the self-hosted
      // connector is gone. On desktop, or inside a wallet's own browser, it also
      // offers the injected provider that is already there.
      await connectWallet()
    } catch (err) {
      setReconnectError(err instanceof Error ? err.message : 'Could not open wallet options.')
    } finally {
      setReconnecting(false)
    }
  }

  if (!signedIn || canSign) return null

  const isWallet = source === 'wallet'

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" strokeWidth={2} />
        <div className="flex flex-col gap-1">
          <p className="font-bold text-white text-sm">Your wallet can&apos;t sign right now</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {isWallet
              ? `You're signed in with an external wallet, but the connection to it has been lost — so nothing can be signed. Reconnect below and you keep this account. You can still see everything meanwhile; you just can't ${action} until it's back.`
              : `Your wallet session didn't finish loading, so nothing can be signed. You can still see your account — you just can't ${action} yet.`}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {/* Reconnecting KEEPS the account. Offering only "sign out" made losing
            the connection look like losing the wallet, which it never was. */}
        {isWallet ? (
          <button
            onClick={handleReconnect}
            disabled={reconnecting || !web3authReady}
            className="flex-1 py-2 text-xs font-black rounded-lg text-black disabled:opacity-50"
            style={{ background: '#a855f7' }}
          >
            {reconnecting ? 'Opening…' : !web3authReady ? 'Loading…' : 'Reconnect wallet'}
          </button>
        ) : (
          <button
            onClick={() => router.refresh()}
            className="flex-1 py-2 text-xs font-bold rounded-lg border text-slate-300 hover:text-white transition-colors"
            style={{ borderColor: '#2a2a3a' }}
          >
            Reload
          </button>
        )}
        <button
          onClick={signOut}
          className="flex-1 py-2 text-xs font-bold rounded-lg border text-slate-300 hover:text-white transition-colors"
          style={{ borderColor: '#2a2a3a' }}
        >
          Sign out
        </button>
      </div>

      {reconnectError && <p className="text-[10px] text-red-400">{reconnectError}</p>}

      {isWallet && (
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Reconnect opens your wallet app to re-approve. If that doesn&apos;t work on this
          phone, signing in with email or Google needs no wallet app at all — but that is a
          different account.
        </p>
      )}
    </div>
  )
}
