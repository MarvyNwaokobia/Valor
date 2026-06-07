import { useState, useEffect, useCallback } from 'react'
import { useWalletClient, usePublicClient } from 'wagmi'
import { getReadSDK, rankPoolAddress, UBI_POOL_CLAIM_ABI } from '@/lib/goodcollective'
import type { Rank } from '@/types/database'

export interface RankPoolStatus {
  isMember: boolean
  claimAmount: string     // human-readable G$ (e.g. "1.2300")
  dailyUbi: string        // human-readable G$ per day
  nextClaimTime: Date | null
  canClaim: boolean
}

export function useRankPool(rank: Rank, walletAddress?: `0x${string}`) {
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()

  const [status, setStatus] = useState<RankPoolStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null)

  const poolAddress = rankPoolAddress(rank)

  const refresh = useCallback(async () => {
    if (!poolAddress || !walletAddress) return
    setLoading(true)
    try {
      const sdk = getReadSDK()
      const [details] = await sdk.getUBIPoolsDetails([poolAddress], walletAddress)
      const now = Date.now()
      const nextClaimRaw = details.nextClaimTime
      const nextClaim = nextClaimRaw && Number(nextClaimRaw) > 0
        ? new Date(Number(nextClaimRaw) * 1000)
        : null
      const claimable = BigInt(details.claimAmount?.toString() ?? '0')
      const daily = BigInt(details.status?.dailyUbi?.toString() ?? '0')

      setStatus({
        isMember:      details.isRegistered ?? false,
        claimAmount:   (Number(claimable) / 1e18).toFixed(4),
        dailyUbi:      (Number(daily) / 1e18).toFixed(4),
        nextClaimTime: nextClaim,
        canClaim:      claimable > 0n && (!nextClaim || nextClaim.getTime() <= now),
      })
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [poolAddress, walletAddress])

  useEffect(() => { refresh() }, [refresh])

  const claim = useCallback(async () => {
    if (!poolAddress || !walletClient || !publicClient) return
    setClaiming(true)
    setClaimError(null)
    try {
      const hash = await walletClient.writeContract({
        address: poolAddress,
        abi: UBI_POOL_CLAIM_ABI,
        functionName: 'claim',
      })
      setClaimTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      await refresh()
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Claim failed')
    } finally {
      setClaiming(false)
    }
  }, [poolAddress, walletClient, publicClient, refresh])

  return { poolAddress, status, loading, claiming, claimError, claimTxHash, refresh, claim }
}
