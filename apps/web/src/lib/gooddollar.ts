import { IdentitySDK, ClaimSDK, Envs, chainConfigs, SupportedChains, type contractEnv } from '@goodsdks/citizen-sdk'
import { REWARDS_CONTRACT } from '@goodsdks/engagement-sdk'
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi, type PublicClient, type WalletClient, type Address } from 'viem'
import { celo } from 'viem/chains'
import { G_TOKEN_ADDRESS } from '@/lib/constants'

export const GD_ENV: contractEnv =
  (process.env.NEXT_PUBLIC_GOODDOLLAR_ENV as contractEnv) ?? 'production'

export const CELO_CHAIN_ID = SupportedChains.CELO
export const ALFAJORES_CHAIN_ID = 44787

const celoConfig = chainConfigs[SupportedChains.CELO]
export const IDENTITY_CONTRACT_ADDRESS =
  celoConfig.contracts[GD_ENV]?.identityContract ?? celoConfig.contracts.production!.identityContract

// GoodDollar UBIScheme (the contract the daily G$ claim is drawn from) on Celo.
const UBI_CONTRACT =
  (celoConfig.contracts[GD_ENV]?.ubiContract ?? celoConfig.contracts.production!.ubiContract) as `0x${string}`

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

// Signer-less HTTP Celo clients with NO Magic / wallet-provider dependency.
// Every GoodDollar READ (whitelist status, identity expiry, claim
// entitlement, next-claim-time) routes through the public client, so it must
// not hinge on useActiveWalletClient() — that Magic-backed client is
// slow or never-ready on mobile Safari (ITP / private-mode storage
// partitioning), which otherwise leaves the daily-claim card / verify screen
// stuck loading forever. The SDK constructors still require a walletClient
// with an account attached, so we hand them a signer-less HTTP one: good
// enough for reads. The real Magic client is only needed to actually SIGN
// (the claim tx, the face-verify message).
function readOnlyClients(account: Address) {
  const publicClient = createPublicClient({
    chain: celo,
    transport: http(CELO_RPC_URL),
  }) as PublicClient
  const walletClient = createWalletClient({
    account,
    chain: celo,
    transport: http(CELO_RPC_URL),
  })
  return { publicClient, walletClient }
}

export function createReadOnlyClaimSDK(account: Address): ClaimSDK {
  const { publicClient, walletClient } = readOnlyClients(account)
  const identitySDK = new IdentitySDK({ account, publicClient, walletClient, env: GD_ENV })
  return new ClaimSDK({ account, publicClient, walletClient, identitySDK, env: GD_ENV })
}

export function createReadOnlyIdentitySDK(account: Address): IdentitySDK {
  const { publicClient, walletClient } = readOnlyClients(account)
  return new IdentitySDK({ account, publicClient, walletClient, env: GD_ENV })
}

// ── Single-signature daily claim ────────────────────────────────────────────
// UBIScheme.claim() is msg.sender-bound (no meta-tx / claimFor), so unlike the
// marketplace permit relay the claim MUST be signed and sent by the user's own
// wallet — it can't be relayed. What we CAN do is make it a single in-app
// signature with no "gas top-up" second prompt, by provisioning gas ourselves
// before submitting. Gas strategy, cheapest / least-friction first:
//   1. Wallet already has enough CELO  → native gas.
//   2. Low CELO but holds G$           → pay gas IN G$ via Celo CIP-64
//                                         (feeCurrency) — no CELO, no faucet.
//   3. Neither (true first-timer)      → GoodDollar's free gasless faucet tops
//                                         the wallet up, then native gas.
// The gas itself is sponsored by GoodDollar's faucet (funded by them), never us.

const CLAIM_ABI = parseAbi(['function claim() returns (bool)'])
const BALANCE_OF_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])

// A claim tx is cheap on Celo (~0.001-0.005 CELO); 0.01 is a comfortable floor.
const MIN_CELO_FOR_CLAIM = 10_000_000_000_000_000n // 0.01 CELO (wei)

// GoodDollar's gasless backend faucet: tops verified wallets up with CELO for
// free (funded by GoodDollar), no signature required. Same endpoint the SDK
// itself falls back to.
async function requestGoodDollarFaucet(account: Address): Promise<void> {
  const backend = Envs[GD_ENV]?.backend
  if (!backend) return
  await fetch(`${backend}/verify/topWallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainId: CELO_CHAIN_ID, account }),
  }).catch(() => {})
}

async function waitForCelo(
  publicClient: PublicClient,
  account: Address,
  minWei: bigint,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const bal = await publicClient.getBalance({ address: account })
    if (bal >= minWei) return true
    await new Promise((r) => setTimeout(r, 2500))
  }
  return false
}

// Submit UBIScheme.claim() from the user's own wallet — one signature. When
// `feeCurrency` is set, gas is paid in that ERC20 (G$) via CIP-64 instead of
// native CELO.
async function sendClaimTx(
  walletClient: WalletClient,
  account: Address,
  feeCurrency?: `0x${string}`,
): Promise<`0x${string}`> {
  const data = encodeFunctionData({ abi: CLAIM_ABI, functionName: 'claim' })
  return walletClient.sendTransaction({
    account,
    chain: celo,
    to: UBI_CONTRACT,
    data,
    ...(feeCurrency ? { feeCurrency } : {}),
  } as Parameters<WalletClient['sendTransaction']>[0])
}

// Claims the daily UBI as a single in-app signature, provisioning gas as needed.
// Returns the confirmed transaction hash.
export async function claimUBI(
  walletClient: WalletClient,
  account: Address,
): Promise<`0x${string}`> {
  const { publicClient } = readOnlyClients(account)

  // Preflight: UBIScheme.claim() returns false (does NOT revert) when there's
  // nothing to claim, so without this guard we'd burn a signature and show a
  // false "claimed" with 0 G$. Confirm there's a live entitlement first.
  const { amount } = await createReadOnlyClaimSDK(account).checkEntitlement()
  if (amount === 0n) {
    throw new Error('No UBI available to claim for this period.')
  }

  const celoBalance = await publicClient.getBalance({ address: account })

  // 1. Enough CELO already — native gas, one signature.
  if (celoBalance >= MIN_CELO_FOR_CLAIM) {
    const hash = await sendClaimTx(walletClient, account)
    await withTimeout(publicClient.waitForTransactionReceipt({ hash }), 60000, 'Claim confirmation timed out')
    return hash
  }

  // 2. Low CELO but holds G$ — pay gas in G$ (CIP-64). No faucet wait needed.
  const gBalance = await publicClient.readContract({
    address: G_TOKEN_ADDRESS,
    abi: BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args: [account],
  })
  if (gBalance > 0n) {
    try {
      const hash = await sendClaimTx(walletClient, account, G_TOKEN_ADDRESS)
      await withTimeout(publicClient.waitForTransactionReceipt({ hash }), 60000, 'Claim confirmation timed out')
      return hash
    } catch (err) {
      // Some wallet providers may not support Celo fee-currency (CIP-64) txs;
      // fall through to the gasless CELO faucet path.
      console.warn('[GoodDollar] G$-gas claim failed, falling back to faucet:', err)
    }
  }

  // 3. True first-timer (no CELO, no/failed G$ gas) — GoodDollar's free faucet.
  await requestGoodDollarFaucet(account)
  const funded = await waitForCelo(publicClient, account, MIN_CELO_FOR_CLAIM, 30000)
  if (!funded) {
    throw new Error('Could not get gas for the claim. Please try again in a moment.')
  }
  const hash = await sendClaimTx(walletClient, account)
  await withTimeout(publicClient.waitForTransactionReceipt({ hash }), 60000, 'Claim confirmation timed out')
  return hash
}

// Read-only whitelist check — the GoodDollar identity whitelist is keyed to the
// on-chain wallet address (same address every time for a given email/Google
// login via Magic), so this is the single source of truth for "is this account
// verified" across sessions and devices. No signature or Magic wallet needed.
export async function checkWhitelistStatusReadOnly(
  address: Address,
): Promise<{ isWhitelisted: boolean; root: `0x${string}` }> {
  const sdk = createReadOnlyIdentitySDK(address)
  return withTimeout(
    sdk.getWhitelistedRoot(address),
    12000,
    'GoodDollar whitelist lookup timed out',
  )
}

export async function getIdentityExpiryReadOnly(address: Address): Promise<IdentityExpiry> {
  try {
    const sdk = createReadOnlyIdentitySDK(address)
    const { lastAuthenticated, authPeriod } = await withTimeout(
      sdk.getIdentityExpiryData(address),
      10000,
      'GoodDollar expiry data lookup timed out',
    )
    const { expiryTimestamp } = sdk.calculateIdentityExpiry(lastAuthenticated, authPeriod)
    const expiresAt = new Date(Number(expiryTimestamp))
    const now = Date.now()
    const daysLeft = Math.max(0, Math.floor((expiresAt.getTime() - now) / (1000 * 60 * 60 * 24)))
    return { expiresAt, daysLeft, isExpired: expiresAt.getTime() <= now }
  } catch (err) {
    console.warn('[GoodDollar] getIdentityExpiryReadOnly failed:', err)
    return { expiresAt: null, daysLeft: 0, isExpired: false }
  }
}

