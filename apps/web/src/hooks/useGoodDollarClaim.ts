import { useState, useCallback, useEffect } from 'react'
import { usePublicClient } from 'wagmi'
import { useActiveWalletClient } from '@/hooks/useActiveWalletClient'
import { createClaimSDK, withTimeout } from '@/lib/gooddollar'

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
  const walletClient = useActiveWalletClient()

  const [status, setStatus]               = useState<GDClaimStatus>('loading')
  const [entitlement, setEntitlement]     = useState('0')
  const [nextClaimTime, setNextClaimTime] = useState<Date | null>(null)
  const [claiming, setClaiming]           = useState(false)
  const [claimStep, setClaimStep]         = useState('Confirm in your wallet')
  const [txHash, setTxHash]               = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const sdkReady = !!publicClient && !!walletClient && !!walletAddress

  const refresh = useCallback(async () => {
    console.log('[Claim] refresh called. publicClient:', !!publicClient, 'walletClient:', !!walletClient, 'walletAddress:', walletAddress)
    if (!publicClient || !walletClient || !walletAddress) {
      console.warn('[Claim] refresh: missing publicClient, walletClient, or walletAddress — staying in loading state')
      setStatus('loading')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      console.log('[Claim] refresh: creating ClaimSDK')
      const sdk = await createClaimSDK(publicClient, walletClient, walletAddress)
      console.log('[Claim] refresh: ClaimSDK created, calling getWalletClaimStatus')
      const walletStatus = await withTimeout(
        sdk.getWalletClaimStatus(),
        12000,
        'GoodDollar claim status check timed out'
      )
      console.log('[Claim] refresh: getWalletClaimStatus result:', walletStatus)

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
    } catch (err) {
      console.error('[Claim] refresh failed:', err)
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
      const sdk = await createClaimSDK(publicClient, walletClient, walletAddress)

      const receipt = await sdk.claim(() => {
        // SDK fires this before requesting a gas top-up tx
        setClaimStep('Gas top-up needed · Sign once more')
      })

      setTxHash(receipt.transactionHash)
      setStatus('already_claimed')
      setEntitlement('0')

      // Tell backend to record timestamp + reset decay, and log the claim in
      // the G$ ledger (Bank page's UBI-earned figure) — fire-and-forget
      fetch(`${API}/players/${walletAddress}/daily-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: entitlement, tx_hash: receipt.transactionHash }),
      }).catch(() => {})

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
  }, [sdkReady, publicClient, walletClient, walletAddress, onClaimSuccess, entitlement])

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
