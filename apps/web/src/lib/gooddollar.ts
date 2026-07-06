import { IdentitySDK, ClaimSDK, chainConfigs, SupportedChains, type contractEnv } from '@goodsdks/citizen-sdk'
import { REWARDS_CONTRACT } from '@goodsdks/engagement-sdk'
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Address } from 'viem'
import { celo } from 'viem/chains'

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

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId)
  })
}

export async function createIdentitySDK(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Address,
): Promise<IdentitySDK> {
  return new IdentitySDK({ account, publicClient, walletClient, env: GD_ENV })
}

export async function checkWhitelistStatus(
  publicClient: PublicClient,
  walletClient: WalletClient,
  address: `0x${string}`,
): Promise<{ isWhitelisted: boolean; root: `0x${string}` }> {
  console.log('[GoodDollar] checkWhitelistStatus: starting verification check for', address)
  const sdk = await withTimeout(
    createIdentitySDK(publicClient, walletClient, address),
    10000,
    'GoodDollar SDK initialization timed out'
  )
  const result = await withTimeout(
    sdk.getWhitelistedRoot(address),
    10000,
    'GoodDollar whitelist lookup timed out'
  )
  console.log('[GoodDollar] checkWhitelistStatus result:', result)
  return result
}

export async function generateFaceVerifyLink(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Address,
  callbackUrl?: string,
): Promise<string> {
  console.log('[GoodDollar] generateFaceVerifyLink: generating link')
  const sdk = await withTimeout(
    createIdentitySDK(publicClient, walletClient, account),
    10000,
    'GoodDollar SDK initialization timed out'
  )
  const url = await withTimeout(
    sdk.generateFVLink(
      false,
      callbackUrl ?? `${window.location.origin}/onboarding?step=verify&fv=1`,
      SupportedChains.CELO,
    ),
    10000,
    'GoodDollar face verification link generation timed out'
  )
  console.log('[GoodDollar] generateFaceVerifyLink result url:', url)
  return url
}

export interface IdentityExpiry {
  expiresAt: Date | null
  daysLeft: number
  isExpired: boolean
}

export async function createClaimSDK(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Address,
): Promise<ClaimSDK> {
  const identitySDK = await createIdentitySDK(publicClient, walletClient, account)
  return new ClaimSDK({ account, publicClient, walletClient, identitySDK, env: GD_ENV })
}

// Celo mainnet public RPC — Magic's embedded wallet talks to this same node.
const CELO_RPC_URL = 'https://forno.celo.org'

// A ClaimSDK backed entirely by plain HTTP Celo clients, with NO Magic /
// wallet-provider dependency. Checking claim status (whitelist + entitlement +
// next-claim-time) is fully read-only and routes through the public client, so
// it must not hinge on useActiveWalletClient() — that Magic-backed client is
// slow or never-ready on mobile Safari (ITP / private-mode storage
// partitioning), which otherwise leaves the daily-claim card stuck loading
// forever. The SDK constructor still requires a walletClient with an account
// attached, so we hand it a signer-less HTTP one: good enough for reads, and
// the real Magic client is only needed for the actual claim signature.
export function createReadOnlyClaimSDK(account: Address): ClaimSDK {
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(CELO_RPC_URL),
  }) as PublicClient
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(CELO_RPC_URL),
  })
  const identitySDK = new IdentitySDK({ account, publicClient, walletClient, env: GD_ENV })
  return new ClaimSDK({ account, publicClient, walletClient, identitySDK, env: GD_ENV })
}

export async function getIdentityExpiry(
  publicClient: PublicClient,
  walletClient: WalletClient,
  address: Address,
): Promise<IdentityExpiry> {
  try {
    console.log('[GoodDollar] getIdentityExpiry: fetching for', address)
    const sdk = await withTimeout(
      createIdentitySDK(publicClient, walletClient, address),
      10000,
      'GoodDollar SDK initialization timed out'
    )
    const { lastAuthenticated, authPeriod } = await withTimeout(
      sdk.getIdentityExpiryData(address),
      10000,
      'GoodDollar expiry data lookup timed out'
    )
    const { expiryTimestamp } = sdk.calculateIdentityExpiry(lastAuthenticated, authPeriod)
    const expiresAt = new Date(Number(expiryTimestamp))
    const now = Date.now()
    const daysLeft = Math.max(0, Math.floor((expiresAt.getTime() - now) / (1000 * 60 * 60 * 24)))
    console.log('[GoodDollar] getIdentityExpiry success. Days left:', daysLeft)
    return { expiresAt, daysLeft, isExpired: expiresAt.getTime() <= now }
  } catch (err) {
    console.warn('[GoodDollar] getIdentityExpiry failed:', err)
    return { expiresAt: null, daysLeft: 0, isExpired: false }
  }
}

