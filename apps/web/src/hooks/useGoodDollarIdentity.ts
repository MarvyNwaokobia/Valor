import { useState, useCallback } from 'react'
import { usePublicClient, useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { celo } from 'wagmi/chains'
import {
  checkWhitelistStatus,
  generateFaceVerifyLink,
  getIdentityExpiry,
  type IdentityExpiry,
  withTimeout,
} from '@/lib/gooddollar'

export type IdentityStatus =
  | 'idle'
  | 'checking'
  | 'switching_chain'
  | 'whitelisted'
  | 'not_whitelisted'
  | 'error'

interface UseGoodDollarIdentityReturn {
  status: IdentityStatus
  faceVerifyUrl: string | null
  error: string | null
  identityExpiry: IdentityExpiry | null
  check: (address: `0x${string}`) => Promise<boolean>
  getFaceVerifyUrl: () => Promise<string | null>
  reset: () => void
}

export function useGoodDollarIdentity(): UseGoodDollarIdentityReturn {
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()

  const [status, setStatus] = useState<IdentityStatus>('idle')
  const [faceVerifyUrl, setFaceVerifyUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [identityExpiry, setIdentityExpiry] = useState<IdentityExpiry | null>(null)

  const check = useCallback(
    async (address: `0x${string}`): Promise<boolean> => {
      console.log('[Identity] check called for address:', address, 'status:', status)
      if (!publicClient || !walletClient) {
        console.warn('[Identity] check: Wallet not connected or clients not ready')
        setError('Wallet not connected')
        setStatus('error')
        return false
      }

      // GoodDollar identity contracts live on Celo — switch if on another network
      if (chainId !== celo.id) {
        setStatus('switching_chain')
        console.log('[Identity] Network is not Celo. Initiating switchChainAsync to chainId:', celo.id)
        try {
          await withTimeout(
            switchChainAsync({ chainId: celo.id }),
            15000,
            'Wallet network switch request timed out. Please check your wallet.'
          )
          console.log('[Identity] Network switch completed successfully')
        } catch (err) {
          console.error('[Identity] Network switch failed or timed out:', err)
          const msg = err instanceof Error ? err.message : 'Please switch your wallet to the Celo network and try again.'
          setError(msg)
          setStatus('error')
          return false
        }
      }

      setStatus('checking')
      setError(null)
      console.log('[Identity] check: checking whitelist status for address:', address)

      try {
        const { isWhitelisted } = await withTimeout(
          checkWhitelistStatus(publicClient, walletClient, address),
          10000,
          'Identity verification check timed out.'
        )
        console.log('[Identity] check whitelist result for', address, 'isWhitelisted:', isWhitelisted)

        if (isWhitelisted) {
          setStatus('whitelisted')
          console.log('[Identity] check: whitelisted. Fetching expiry in background...')
          // Fetch expiry in background — non-blocking, non-fatal
          getIdentityExpiry(publicClient, walletClient, address)
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
    [publicClient, walletClient, chainId, switchChainAsync, status],
  )

  const getFaceVerifyUrl = useCallback(async (): Promise<string | null> => {
    if (!publicClient || !walletClient) {
      console.warn('[Identity] getFaceVerifyUrl: publicClient or walletClient not available')
      return null
    }
    console.log('[Identity] getFaceVerifyUrl: starting link generation')
    try {
      const url = await withTimeout(
        generateFaceVerifyLink(publicClient, walletClient),
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

