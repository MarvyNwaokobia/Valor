import { useState, useCallback, useEffect } from 'react'
import { usePublicClient, useWalletClient } from 'wagmi'
import { createClaimSDK } from '@/lib/gooddollar'

export type GDClaimStatus =
  | 'loading'
  | 'can_claim'
  | 'already_claimed'
  | 'not_whitelisted'
  | 'error'

export interface UseGoodDollarClaimReturn {
  status: GDClaimStatus
  entitlement: string        // e.g. "2.50"
  nextClaimTime: Date | null
  claiming: boolean
  claimStep: string          // message shown in the modal during claim
  txHash: string | null
  error: string | null
  claim: () => Promise<void>
  refresh: () => Promise<void>
}

const API = process.env.NEXT_PUBLIC_API_URL ?? ''

function isUserRejection(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('rejected') ||
    msg.includes('denied') ||
    msg.includes('user cancel') ||
    msg.includes('user declin')
  )
}

export function useGoodDollarClaim(
  walletAddress: `0x${string}` | undefined,
  onClaimSuccess?: () => void,
): UseGoodDollarClaimReturn {
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [status, setStatus]               = useState<GDClaimStatus>('loading')
  const [entitlement, setEntitlement]     = useState('0')
  const [nextClaimTime, setNextClaimTime] = useState<Date | null>(null)
  const [claiming, setClaiming]           = useState(false)
  const [claimStep, setClaimStep]         = useState('Confirm in your wallet')
  const [txHash, setTxHash]               = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const sdkReady = !!publicClient && !!walletClient && !!walletAddress

  const refresh = useCallback(async () => {
    if (!publicClient || !walletClient || !walletAddress) {
      setStatus('loading')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const sdk = await createClaimSDK(publicClient, walletClient)
      const walletStatus = await sdk.getWalletClaimStatus()

      if (walletStatus.status === 'can_claim') {
        setStatus('can_claim')
        setEntitlement((Number(walletStatus.entitlement) / 1e18).toFixed(2))
        setNextClaimTime(null)
      } else if (walletStatus.status === 'already_claimed') {
        setStatus('already_claimed')
        setEntitlement('0')
        setNextClaimTime(walletStatus.nextClaimTime ?? null)
      } else {
        // not_whitelisted
        setStatus('not_whitelisted')
        setEntitlement('0')
        setNextClaimTime(null)
      }
    } catch {
      setStatus('error')
    }
  }, [publicClient, walletClient, walletAddress])

  useEffect(() => { refresh() }, [refresh])

  const claim = useCallback(async () => {
    if (!sdkReady || !publicClient || !walletClient || !walletAddress) return
    setClaiming(true)
    setError(null)
    setTxHash(null)
    setClaimStep('Confirm in your wallet')

    try {
      const sdk = await createClaimSDK(publicClient, walletClient)

      const receipt = await sdk.claim(() => {
        // SDK fires this before requesting a gas top-up tx
        setClaimStep('Gas top-up needed · Sign once more')
      })

      setTxHash(receipt.transactionHash)
      setStatus('already_claimed')
      setEntitlement('0')

      // Tell backend to record timestamp + reset decay — fire-and-forget
      fetch(`${API}/players/${walletAddress}/daily-claim`, { method: 'POST' }).catch(() => {})

      onClaimSuccess?.()
    } catch (err) {
      if (!isUserRejection(err)) {
        const raw = err instanceof Error ? err.message : 'Claim failed'
        // Surface a clean message — the SDK sometimes returns verbose contract errors
        if (raw.includes('No UBI available')) {
          setError('No G$ available to claim right now. Try again tomorrow.')
        } else if (raw.includes('verification')) {
          setError('Identity verification required. Complete it in onboarding.')
        } else {
          setError('Claim failed. Please try again.')
        }
      }
    } finally {
      setClaiming(false)
      setClaimStep('Confirm in your wallet')
    }
  }, [sdkReady, publicClient, walletClient, walletAddress, onClaimSuccess])

  return {
    status,
    entitlement,
    nextClaimTime,
    claiming,
    claimStep,
    txHash,
    error,
    claim,
    refresh,
  }
}
