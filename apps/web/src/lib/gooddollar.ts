import { IdentitySDK, chainConfigs, SupportedChains, type contractEnv } from '@goodsdks/citizen-sdk'
import { REWARDS_CONTRACT } from '@goodsdks/engagement-sdk'
import type { PublicClient, WalletClient, Address } from 'viem'

export const GD_ENV: contractEnv =
  (process.env.NEXT_PUBLIC_GOODDOLLAR_ENV as contractEnv) ?? 'production'

export const CELO_CHAIN_ID = SupportedChains.CELO
export const ALFAJORES_CHAIN_ID = 44787

const celoConfig = chainConfigs[SupportedChains.CELO]
export const IDENTITY_CONTRACT_ADDRESS =
  celoConfig.contracts[GD_ENV]?.identityContract ?? celoConfig.contracts.production!.identityContract

// GoodDollar Engagement Rewards contract on Celo mainnet — funded by GoodDollar to reward app users
export const ENGAGEMENT_REWARDS_CONTRACT = REWARDS_CONTRACT

// Valor's registered app wallet on the Engagement Rewards contract
export const VALOR_APP_ADDRESS = (process.env.NEXT_PUBLIC_VALOR_APP_ADDRESS ?? '') as `0x${string}`

export async function createIdentitySDK(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<IdentitySDK> {
  return IdentitySDK.init({ publicClient, walletClient, env: GD_ENV })
}

export async function checkWhitelistStatus(
  publicClient: PublicClient,
  walletClient: WalletClient,
  address: `0x${string}`,
): Promise<{ isWhitelisted: boolean; root: `0x${string}` }> {
  const sdk = await createIdentitySDK(publicClient, walletClient)
  return sdk.getWhitelistedRoot(address)
}

export async function generateFaceVerifyLink(
  publicClient: PublicClient,
  walletClient: WalletClient,
  callbackUrl?: string,
): Promise<string> {
  const sdk = await createIdentitySDK(publicClient, walletClient)
  return sdk.generateFVLink(
    true,
    callbackUrl ?? `${window.location.origin}/onboarding?step=verify`,
    SupportedChains.CELO,
  )
}

export interface IdentityExpiry {
  expiresAt: Date | null
  daysLeft: number
  isExpired: boolean
}

export async function getIdentityExpiry(
  publicClient: PublicClient,
  walletClient: WalletClient,
  address: Address,
): Promise<IdentityExpiry> {
  try {
    const sdk = await createIdentitySDK(publicClient, walletClient)
    const { lastAuthenticated, authPeriod } = await sdk.getIdentityExpiryData(address)
    const { expiryTimestamp } = sdk.calculateIdentityExpiry(lastAuthenticated, authPeriod)
    const expiresAt = new Date(Number(expiryTimestamp))
    const now = Date.now()
    const daysLeft = Math.max(0, Math.floor((expiresAt.getTime() - now) / (1000 * 60 * 60 * 24)))
    return { expiresAt, daysLeft, isExpired: expiresAt.getTime() <= now }
  } catch {
    return { expiresAt: null, daysLeft: 0, isExpired: false }
  }
}
