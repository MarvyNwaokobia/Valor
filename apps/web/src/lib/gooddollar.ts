import { IdentitySDK, chainConfigs, SupportedChains, type contractEnv } from '@goodsdks/citizen-sdk'
import type { PublicClient, WalletClient } from 'viem'

export const GD_ENV: contractEnv =
  (import.meta.env.VITE_GOODDOLLAR_ENV as contractEnv) ?? 'production'

export const CELO_CHAIN_ID = SupportedChains.CELO
export const ALFAJORES_CHAIN_ID = 44787

const celoConfig = chainConfigs[SupportedChains.CELO]
export const IDENTITY_CONTRACT_ADDRESS =
  celoConfig.contracts[GD_ENV]?.identityContract ?? celoConfig.contracts.production!.identityContract

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
