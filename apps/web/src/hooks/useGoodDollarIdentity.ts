import { useState, useCallback } from 'react'
import { usePublicClient } from 'wagmi'
import { useActiveWalletClient } from '@/hooks/useActiveWalletClient'
import {
  checkWhitelistStatusReadOnly,
  generateFaceVerifyLink,
  getIdentityExpiryReadOnly,
  type IdentityExpiry,
  withTimeout,
} from '@/lib/gooddollar'

export type IdentityStatus =
  | 'idle'
  | 'checking'
  | 'whitelisted'
  | 'not_whitelisted'
  | 'error'

interface UseGoodDollarIdentityReturn {
  status: IdentityStatus
  faceVerifyUrl: string | null
  error: string | null
  identityExpiry: IdentityExpiry | null
  check: (address: `0x${string}`) => Promise<boolean>
  getFaceVerifyUrl: (address: `0x${string}`, callbackUrl?: string) => Promise<string | null>
  reset: () => void
}

export function useGoodDollarIdentity(): UseGoodDollarIdentityReturn {
  const publicClient = usePublicClient()
  // Magic's embedded wallet is initialized on Celo only, so there's no
  // "wrong network" state to detect or switch away from like with a
  // bring-your-own-wallet flow.
  const walletClient = useActiveWalletClient()

  const [status, setStatus] = useState<IdentityStatus>('idle')
  const [faceVerifyUrl, setFaceVerifyUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [identityExpiry, setIdentityExpiry] = useState<IdentityExpiry | null>(null)

  // Whitelist status is read-only and keyed to the on-chain address, so it does
  // NOT need the Magic wallet client (undefined/slow on mobile Safari). Only the
  // address is required — this is what lets us auto-recognize an already-verified
  // account on any device without a manual re-verify.
  const check = useCallback(
    async (address: `0x${string}`): Promise<boolean> => {
      console.log('[Identity] check called for address:', address, 'status:', status)
      const key = `gd_verified_${address.toLowerCase()}`

      // ── Fast path: a wallet we've SEEN verified recently is a recognised user.
      // Verification lives on-chain and is stable, so once true we trust it for a
      // window and never make the user sit through the RPC/verify screen again.
      // A background re-check keeps it honest (clears the cache if it ever lapses).
      try {
        const cached = Number(localStorage.getItem(key) || 0)
        if (cached && Date.now() - cached < 7 * 24 * 3600 * 1000) {
          setStatus('whitelisted')
          void checkWhitelistStatusReadOnly(address)
            .then(({ isWhitelisted }) => {
              if (isWhitelisted) localStorage.setItem(key, String(Date.now()))
              else { localStorage.removeItem(key); setStatus('not_whitelisted') } // GoodDollar says it lapsed
            })
            .catch(() => { /* keep trusting the cache on a flaky read */ })
          return true
        }
      } catch { /* private mode — fall through to the live check */ }

      setStatus('checking')
      setError(null)

      // Live check, with one retry — a single flaky forno read must NOT make a
      // verified user look unverified.
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { isWhitelisted } = await checkWhitelistStatusReadOnly(address)
          console.log('[Identity] whitelist result for', address, '=', isWhitelisted, `(try ${attempt + 1})`)
          if (isWhitelisted) {
            try { localStorage.setItem(key, String(Date.now())) } catch { /* ignore */ }
            setStatus('whitelisted')
            getIdentityExpiryReadOnly(address).then(setIdentityExpiry).catch(() => {})
            return true
          }
          setStatus('not_whitelisted')
          return false
        } catch (err) {
          lastErr = err
        }
      }
      console.error('[Identity] check failed after retries:', lastErr)
      setError(lastErr instanceof Error ? lastErr.message : 'Identity check failed')
      setStatus('error')
      return false
    },
    [status],
  )

  const getFaceVerifyUrl = useCallback(async (address: `0x${string}`, callbackUrl?: string): Promise<string | null> => {
    if (!publicClient || !walletClient) {
      console.warn('[Identity] getFaceVerifyUrl: publicClient or walletClient not available')
      return null
    }
    console.log('[Identity] getFaceVerifyUrl: starting link generation')
    try {
      const url = await withTimeout(
        generateFaceVerifyLink(publicClient, walletClient, address, callbackUrl),
        10000,
        'Generating verification link timed out.'
      )
      console.log('[Identity] getFaceVerifyUrl success:', url)
      setFaceVerifyUrl(url)
      return url
    } catch (err) {
      console.error('[Identity] getFaceVerifyUrl failed or timed out:', err)
      const msg = err instanceof Error ? err.message : 'Failed to generate verification link'
      setError(msg)
      setStatus('error')
      return null
    }
  }, [publicClient, walletClient])

  const reset = useCallback(() => {
    console.log('[Identity] reset state')
    setStatus('idle')
    setFaceVerifyUrl(null)
    setError(null)
    setIdentityExpiry(null)
  }, [])

  return { status, faceVerifyUrl, error, identityExpiry, check, getFaceVerifyUrl, reset }
}
