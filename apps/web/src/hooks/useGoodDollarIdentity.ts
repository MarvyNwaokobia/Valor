import { useState, useCallback } from 'react'
import { usePublicClient, useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { celo } from 'wagmi/chains'
import {
  checkWhitelistStatus,
  generateFaceVerifyLink,
  getIdentityExpiry,
  type IdentityExpiry,
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
      if (!publicClient || !walletClient) {
        setError('Wallet not connected')
        setStatus('error')
        return false
      }

      // GoodDollar identity contracts live on Celo — switch if on another network
      if (chainId !== celo.id) {
        setStatus('switching_chain')
        try {
          await switchChainAsync({ chainId: celo.id })
        } catch {
          setError('Please switch your wallet to the Celo network and try again.')
          setStatus('error')
          return false
        }
      }

      setStatus('checking')
      setError(null)

      try {
        const { isWhitelisted } = await checkWhitelistStatus(publicClient, walletClient, address)

        if (isWhitelisted) {
          setStatus('whitelisted')
          // Fetch expiry in background — non-blocking, non-fatal
          getIdentityExpiry(publicClient, walletClient, address)
            .then(setIdentityExpiry)
            .catch(() => {})
          return true
        } else {
          setStatus('not_whitelisted')
          return false
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Identity check failed'
        setError(msg)
        setStatus('error')
        return false
      }
    },
    [publicClient, walletClient, chainId, switchChainAsync],
  )

  const getFaceVerifyUrl = useCallback(async (): Promise<string | null> => {
    if (!publicClient || !walletClient) return null
    try {
      const url = await generateFaceVerifyLink(publicClient, walletClient)
      setFaceVerifyUrl(url)
      return url
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate verification link'
      setError(msg)
      return null
    }
  }, [publicClient, walletClient])

  const reset = useCallback(() => {
    setStatus('idle')
    setFaceVerifyUrl(null)
    setError(null)
    setIdentityExpiry(null)
  }, [])

  return { status, faceVerifyUrl, error, identityExpiry, check, getFaceVerifyUrl, reset }
}
