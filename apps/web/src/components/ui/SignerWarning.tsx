'use client'

import { AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSignerReady } from '@/hooks/useSignerReady'
import { useSignOut } from '@/hooks/useSignOut'
import { useResolvedAuth } from '@/hooks/useResolvedAuth'

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
              ? `You're signed in with an external wallet, but this browser has no way to reach it, so nothing can be signed. You can still see your account — you just can't ${action} until it's reconnected.`
              : `Your wallet session didn't finish loading, so nothing can be signed. You can still see your account — you just can't ${action} yet.`}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => router.refresh()}
          className="flex-1 py-2 text-xs font-bold rounded-lg border text-slate-300 hover:text-white transition-colors"
          style={{ borderColor: '#2a2a3a' }}
        >
          Reload
        </button>
        <button
          onClick={signOut}
          className="flex-1 py-2 text-xs font-black rounded-lg text-black"
          style={{ background: '#ef4444' }}
        >
          {isWallet ? 'Sign in another way' : 'Sign out'}
        </button>
      </div>

      {isWallet && (
        <p className="text-[10px] text-slate-500 leading-relaxed">
          On a phone, signing in with email or Google works without a wallet app.
        </p>
      )}
    </div>
  )
}
