import { useMemo, useCallback } from 'react'
import { usePublicClient, useWalletClient, useSignTypedData, useChainId } from 'wagmi'
import { EngagementRewardsSDK } from '@goodsdks/engagement-sdk'
import { zeroAddress } from 'viem'
import { ENGAGEMENT_REWARDS_CONTRACT, VALOR_APP_ADDRESS } from '@/lib/gooddollar'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

// Matches the backend's SignClaimResponse shape
interface SignClaimResponse {
  app_address: `0x${string}`
  app_signature: `0x${string}`
  valid_until_block: number
  description: string
}

export function useValorEngagementRewards() {
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { signTypedDataAsync } = useSignTypedData()
  const chainId = useChainId()

  const sdk = useMemo(() => {
    if (!publicClient || !walletClient) return null
    return new EngagementRewardsSDK(publicClient, walletClient, ENGAGEMENT_REWARDS_CONTRACT)
  }, [publicClient, walletClient])

  const isReady = !!sdk && !!VALOR_APP_ADDRESS

  const canClaim = useCallback(
    async (userAddress: `0x${string}`): Promise<boolean> => {
      if (!sdk || !VALOR_APP_ADDRESS) return false
      try {
        return await sdk.canClaim(VALOR_APP_ADDRESS, userAddress)
      } catch {
        return false
      }
    },
    [sdk],
  )

  /**
   * Full two-signature claim flow:
   * 1. Backend signs AppClaim (proves Valor authorised this user)
   * 2. User signs Claim (proves user consents)
   * 3. Frontend submits nonContractAppClaim — user pays gas, GoodDollar pays G$
   */
  const claimEngagementReward = useCallback(
    async (userAddress: `0x${string}`) => {
      if (!sdk || !VALOR_APP_ADDRESS) throw new Error('Engagement rewards not configured')

      // Step 1: request app signature from Valor backend
      const res = await fetch(`${API_URL}/rewards/sign-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: userAddress }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Backend error' }))
        throw new Error(error ?? 'Failed to get app signature')
      }
      const { app_signature, valid_until_block, description }: SignClaimResponse = await res.json()

      // Step 2: user signs Claim EIP-712 message
      const userSignature = await signTypedDataAsync({
        domain: {
          name: 'EngagementRewards',
          version: '1.0',
          chainId,
          verifyingContract: ENGAGEMENT_REWARDS_CONTRACT,
        },
        types: {
          Claim: [
            { name: 'app', type: 'address' },
            { name: 'inviter', type: 'address' },
            { name: 'validUntilBlock', type: 'uint256' },
            { name: 'description', type: 'string' },
          ],
        },
        message: {
          app: VALOR_APP_ADDRESS,
          inviter: zeroAddress,
          validUntilBlock: BigInt(valid_until_block),
          description,
        },
        primaryType: 'Claim',
      })

      // Step 3: submit on-chain — GoodDollar's pool pays the G$, user pays Celo gas
      return sdk.nonContractAppClaim(
        VALOR_APP_ADDRESS,
        zeroAddress,
        BigInt(valid_until_block),
        userSignature,
        app_signature,
      )
    },
    [sdk, signTypedDataAsync, chainId],
  )

  const getRewardAmount = useCallback(async (): Promise<bigint> => {
    if (!sdk) return 0n
    try {
      return await sdk.getRewardAmount()
    } catch {
      return 0n
    }
  }, [sdk])

  return { canClaim, claimEngagementReward, getRewardAmount, isReady }
}
