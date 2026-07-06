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

      setStatus('checking')
      setError(null)
      console.log('[Identity] check: checking whitelist status for address:', address)

      try {
        const { isWhitelisted } = await checkWhitelistStatusReadOnly(address)
        console.log('[Identity] check whitelist result for', address, 'isWhitelisted:', isWhitelisted)

        if (isWhitelisted) {
          setStatus('whitelisted')
          console.log('[Identity] check: whitelisted. Fetching expiry in background...')
          // Fetch expiry in background — non-blocking, non-fatal
          getIdentityExpiryReadOnly(address)
            .then((expiry) => {
              console.log('[Identity] Background expiry fetched:', expiry)
              setIdentityExpiry(expiry)
            })
            .catch((err) => {
              console.warn('[Identity] Background expiry fetch failed:', err)
            })
          return true
        } else {
          setStatus('not_whitelisted')
          console.log('[Identity] check: not whitelisted.')
          return false
        }
      } catch (err) {
        console.error('[Identity] check failed or timed out:', err)
        const msg = err instanceof Error ? err.message : 'Identity check failed'
        setError(msg)
        setStatus('error')
        return false
      }
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
