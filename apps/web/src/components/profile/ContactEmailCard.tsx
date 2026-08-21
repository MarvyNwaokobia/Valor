'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Check, Loader2 } from 'lucide-react'
import { getMagic } from '@/lib/magic'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  walletAddress: string
}

/**
 * Support/lookup contact email for a wallet-only account (never signed in
 * through Magic). Deliberately NOT a sign-in method — Magic's OTP can only
 * ever resolve to a wallet IT minted, never to an externally-connected one,
 * so this can't restore access to this wallet no matter what. It exists so
 * support can reach the player, nothing more; the copy below says so.
 *
 * Verification talks to the Magic SDK singleton directly (getMagic()), NOT
 * through useMagicAuthContext(). That context's loginWithEmailOTP calls
 * refresh(), which publishes whatever session it creates as the app's ACTIVE
 * one — flipping every useResolvedAuth() consumer over to a different wallet
 * for as long as that session lives. Going around it means the transient
 * Magic session used only to prove "you own this inbox" never touches the
 * player's real session, not even for a render.
 */
export default function ContactEmailCard({ walletAddress }: Props) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['contact-email', walletAddress],
    queryFn: async () => {
      const res = await fetch(`${API}/players/${walletAddress}/contact-email`)
      if (!res.ok) throw new Error('failed')
      return res.json() as Promise<{ has_contact_email: boolean }>
    },
    enabled: !!walletAddress,
    staleTime: 60_000,
  })

  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleVerify() {
    if (!EMAIL_RE.test(email) || pending) return
    setPending(true)
    setError(null)
    try {
      const magic = getMagic()
      if (!magic) throw new Error('Not available right now — try again.')

      await magic.auth.loginWithEmailOTP({ email, showUI: true })
      const info = await magic.user.getInfo()
      await magic.user.logout()
      if (!info.email) throw new Error('Could not confirm that email — try again.')

      const res = await fetch(`${API}/players/${walletAddress}/contact-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: info.email }),
      })
      if (!res.ok) throw new Error('Could not save that email — try again.')

      setExpanded(false)
      setEmail('')
      void queryClient.invalidateQueries({ queryKey: ['contact-email', walletAddress] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify that email — try again.')
    } finally {
      setPending(false)
    }
  }

  if (isLoading) return null
  const linked = !!data?.has_contact_email

  return (
    <div className="rounded-xl border border-valor-border bg-valor-surface-2/50 p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Mail size={15} className={linked ? 'text-green-400' : 'text-slate-400'} />
        <p className="text-sm font-bold text-white flex-1">
          {linked ? 'Contact email on file' : 'Add a contact email'}
        </p>
        {linked && <Check size={14} className="text-green-400" />}
      </div>
      <p className="text-slate-500 text-xs leading-relaxed">
        For account support only — it does not let you sign in with your
        username instead of your wallet. Only your wallet can do that.
      </p>

      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="self-start text-xs font-bold text-valor-gold hover:text-valor-gold-light transition-colors"
        >
          {linked ? 'Change email' : 'Add an email'}
        </button>
      )}

      {expanded && (
        <div className="flex flex-col gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
            disabled={pending}
            className="w-full px-3 py-2.5 rounded-lg bg-valor-surface border border-valor-border text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-valor-gold/50"
            onKeyDown={(e) => { if (e.key === 'Enter') void handleVerify() }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setExpanded(false); setError(null) }}
              disabled={pending}
              className="px-3 min-h-9 rounded-lg border border-valor-border text-slate-300 font-bold text-xs hover:text-white transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleVerify()}
              disabled={pending || !EMAIL_RE.test(email)}
              className="flex-1 min-h-9 rounded-lg bg-valor-gold text-black font-bold text-xs hover:bg-valor-gold-light transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {pending ? <Loader2 className="animate-spin" size={13} /> : null}
              {pending ? 'Sending code…' : 'Verify & save'}
            </button>
          </div>
          {error && <p className="text-red-400 text-xs font-medium">{error}</p>}
        </div>
      )}
    </div>
  )
}
