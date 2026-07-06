import { useState, useCallback, useEffect } from 'react'
import { useActiveWalletClient } from '@/hooks/useActiveWalletClient'
import { claimUBI, createReadOnlyClaimSDK, withTimeout } from '@/lib/gooddollar'

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
  const walletClient = useActiveWalletClient()

  const [status, setStatus]               = useState<GDClaimStatus>('loading')
  const [entitlement, setEntitlement]     = useState('0')
  const [nextClaimTime, setNextClaimTime] = useState<Date | null>(null)
  const [claiming, setClaiming]           = useState(false)
  const [claimStep, setClaimStep]         = useState('Confirm the claim in your wallet')
  const [txHash, setTxHash]               = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  // Status check is read-only — it must NOT wait on the Magic wallet client
  // (undefined/slow on mobile Safari). Only the wallet ADDRESS is needed; the
  // SDK runs against plain HTTP Celo clients. See createReadOnlyClaimSDK.
  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setStatus('loading')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const sdk = createReadOnlyClaimSDK(walletAddress)
      const walletStatus = await withTimeout(
        sdk.getWalletClaimStatus(),
        12000,
        'GoodDollar claim status check timed out'
      )

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
  }, [walletAddress])

  useEffect(() => { refresh() }, [refresh])

  const claim = useCallback(async () => {
    if (!walletClient?.account || !walletAddress) return
    setClaiming(true)
    setError(null)
    setTxHash(null)
    setClaimStep('Confirm the claim in your wallet')

    try {
      // Single in-app signature — gas is provisioned automatically (native CELO,
      // paid in G$, or via GoodDollar's free faucet). No second "top-up" prompt.
      const hash = await claimUBI(walletClient, walletAddress)

      setTxHash(hash)
      setStatus('already_claimed')
      setEntitlement('0')

      // Populate the next-claim countdown so the card can immediately show
      // "Next claim in Xh Ym" after claiming. Read-only, non-blocking.
      createReadOnlyClaimSDK(walletAddress)
        .nextClaimTime()
        .then((t) => setNextClaimTime(t))
        .catch(() => {})

      // Tell backend to record timestamp + reset decay, and log the claim in
      // the G$ ledger (Bank page's UBI-earned figure) — fire-and-forget
      fetch(`${API}/players/${walletAddress}/daily-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: entitlement, tx_hash: hash }),
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
        } else if (raw.includes('gas')) {
          setError('Could not get gas for the claim. Please try again in a moment.')
        } else {
          setError('Claim failed. Please try again.')
        }
      }
    } finally {
      setClaiming(false)
      setClaimStep('Confirm the claim in your wallet')
    }
  }, [walletClient, walletAddress, onClaimSuccess, entitlement])

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
