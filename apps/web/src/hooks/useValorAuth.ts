import { useEffect, useRef } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useSignMessage } from 'wagmi'
import { supabase } from '@/lib/supabase'

/**
 * After Privy authentication, signs a wallet message, exchanges it for a
 * Supabase JWT via POST /auth/token, and sets the Supabase session.
 *
 * Once the session is set, auth.jwt()->>'sub' in RLS policies equals the
 * connected wallet address — locking every write to the correct owner.
 */
export function useValorAuth() {
  const { authenticated } = usePrivy()
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const authedWallet = useRef<string | null>(null)

  useEffect(() => {
    if (!authenticated || !address) return
    // Don't re-auth if the same wallet is already authed
    if (authedWallet.current === address.toLowerCase()) return

    async function run() {
      try {
        // Timestamp-bound message — prevents replay attacks (backend does not
        // enforce freshness here, but this is a good habit)
        const message = [
          'Sign in to Valor',
          `Wallet: ${address}`,
          `Timestamp: ${Math.floor(Date.now() / 1000)}`,
        ].join('\n')

        const signature = await signMessageAsync({ message })

        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: address, message, signature }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          console.error('[valor-auth] token request failed:', err)
          return
        }

        const { token } = await res.json()

        // Give Supabase the JWT — all subsequent queries run as "authenticated"
        // with sub = wallet_address, satisfying RLS policies
        const { error } = await supabase.auth.setSession({
          access_token:  token,
          refresh_token: '',
        })

        if (error) {
          console.error('[valor-auth] setSession failed:', error.message)
          return
        }

        authedWallet.current = address!.toLowerCase()
      } catch (err) {
        // Non-fatal: RLS falls back to anon restrictions; log and continue
        console.error('[valor-auth] authentication error:', err)
      }
    }

    run()
  }, [authenticated, address, signMessageAsync])
}
