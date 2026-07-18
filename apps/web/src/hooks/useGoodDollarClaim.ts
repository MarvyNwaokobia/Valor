import { useState, useCallback, useEffect } from 'react'
import { useActiveWalletClient } from '@/hooks/useActiveWalletClient'
import { claimUBI, createReadOnlyClaimSDK, getIdentityExpiryReadOnly, withTimeout } from '@/lib/gooddollar'

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

    // The status read hits GoodDollar's contracts through a public RPC that can
    // hiccup (load spikes, mobile privacy). Retry once so a single flaky read
    // doesn't strand a user on "couldn't load".
    const sdk = createReadOnlyClaimSDK(walletAddress)
    let walletStatus: Awaited<ReturnType<typeof sdk.getWalletClaimStatus>> | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        walletStatus = await withTimeout(sdk.getWalletClaimStatus(), 15000, 'GoodDollar claim status check timed out')
        break
      } catch (err) {
        if (attempt === 1) console.error('[Claim] status read failed after retry:', err)
      }
    }

    // The bundled status read can THROW for an unverified wallet (GoodDollar's
    // whitelist lookup reverts for a wallet with no identity). Don't call that
    // "couldn't load" — fall back to a plain whitelist check so an unverified user
    // gets the actionable Verify prompt, and only a REAL read failure (both throw)
    // shows "couldn't load".
    if (!walletStatus) {
      setEntitlement('0'); setNextClaimTime(null)
      // The bundled read failed. Only prompt re-verify if GoodDollar's OWN expiry says
      // the identity has lapsed — which also correctly flags a never-verified wallet
      // (its last-auth is 0 → expired). A verified wallet whose read merely hiccuped is
      // NOT expired, so it shows a benign "couldn't load", never a re-verify nag.
      const expiry = await getIdentityExpiryReadOnly(walletAddress).catch(() => null)
      setStatus(expiry?.isExpired ? 'not_whitelisted' : 'error')
      return
    }

    if (walletStatus.status === 'can_claim') {
      setStatus('can_claim')
      setEntitlement((Number(walletStatus.entitlement) / 1e18).toFixed(2))
      setNextClaimTime(null)
    } else if (walletStatus.status === 'already_claimed') {
      setStatus('already_claimed')
      setEntitlement('0')
      setNextClaimTime(walletStatus.nextClaimTime ?? null)
    } else {
      // GoodDollar returned a status that isn't can_claim/already_claimed. This does
      // NOT prove the wallet is unverified — GoodDollar auth lasts 180 days, and a
      // verified wallet can be in a transient non-claim state. Per the HARD RULE
      // (feedback-identity-reverify), the ONLY thing allowed to trigger a re-verify
      // prompt is GoodDollar's OWN expiry saying the identity has lapsed. So confirm
      // against the real on-chain expiry; if it's NOT expired, fail OPEN — never nag a
      // verified user. (A genuinely unverified claim just fails harmlessly on-chain.)
      setEntitlement('0')
      const expiry = await getIdentityExpiryReadOnly(walletAddress).catch(() => null)
      if (expiry?.isExpired) {
        setStatus('not_whitelisted')  // GoodDollar itself says lapsed → real re-verify
        setNextClaimTime(null)
      } else {
        // Verified, just not claimable right now — treat as "come back later", not a nag.
        setStatus('already_claimed')
        setNextClaimTime(walletStatus.nextClaimTime ?? null)
      }
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
