/**
 * @module editions/chain
 * @description The chain and permit domain the active edition transacts on.
 *
 * Every call site that used to import `celo` from `viem/chains` or write
 * `chainId: 42220` inline now asks here instead. Nothing about behaviour changes
 * today: the web and MiniPay editions are both Celo, so these resolve to exactly
 * what was hardcoded. What changes is that adding a chain becomes a config edit
 * rather than a hunt through fifteen files.
 *
 * DELIBERATELY NOT ROUTED THROUGH HERE
 * ------------------------------------
 * Some Celo references are protocol-bound and must stay Celo whatever edition is
 * running, because the protocol only exists there:
 *
 *   • lib/gooddollar.ts     — GoodDollar identity and UBI claims (Celo and Fuse)
 *   • lib/goodcollective.ts — GoodCollective rank pools (Celo)
 *   • lib/magic.ts          — Magic embedded wallet, the web edition's auth
 *
 * Making those follow the active edition would point a session at contracts that
 * do not exist on the chain it is running against. `lib/constants.ts` keeps
 * `CELO_CHAIN_ID` for exactly this reason: it names Celo on purpose.
 */

import { celo, type Chain } from 'viem/chains'
import { edition } from './index'
import { WEB_EDITION } from './web/config'

/** Every chain any edition can run on, by chain id. */
const CHAINS: Record<number, Chain> = {
  [celo.id]: celo,
}

/**
 * The viem `Chain` for the active edition.
 *
 * Falls back to Celo for an id with no chain object, which can only happen if an
 * edition config names a chain nobody added above. Celo is the safe fallback for
 * the same reason `web` is the safe edition default: the existing, funded,
 * working path is better than refusing to transact.
 */
export function activeChain(): Chain {
  const id = edition().chain.id
  return CHAINS[id] ?? celo
}

/** Chain id for the active edition. Shorthand for `activeChain().id`. */
export function activeChainId(): number {
  return activeChain().id
}

/**
 * A block-explorer link for a transaction on a SPECIFIC chain.
 *
 * Takes the chain id rather than reading the active edition, because a stored
 * transaction belongs to whichever chain it was mined on, which is not
 * necessarily the one this session is transacting with. Valor writes the same
 * match record to every chain it runs on, so a battle can carry a Celo hash and
 * an L1 hash at once; resolving either against `activeChain()` would send half
 * of them to an explorer that has never heard of them.
 *
 * Returns `null` for a chain with no known explorer, so callers render nothing
 * rather than a dead link. `null` is also correct for the placeholder hashes
 * this codebase stores for off-chain items (`offchain-{id}`), which callers
 * should filter with the `0x` check they already do.
 */
export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const url = CHAINS[chainId]?.blockExplorers?.default?.url
  return url ? `${url.replace(/\/$/, '')}/tx/${txHash}` : null
}

/**
 * The EIP-712 domain for the active edition's currency `permit`.
 *
 * Returns `null` when the edition has no permit-capable currency — MiniPay,
 * which cannot sign typed data at all. Callers must treat `null` as "this
 * edition does not do permits" and take their non-signature path rather than
 * substituting a default. Guessing a domain produces a signature that verifies
 * locally and reverts on-chain.
 */
export function permitDomain(): {
  name: string
  version: string
  chainId: number
  verifyingContract: `0x${string}`
} | null {
  const { currency, chain } = edition()
  if (!currency.permit || !currency.address) return null
  return {
    name: currency.permit.name,
    version: currency.permit.version,
    chainId: chain.id,
    verifyingContract: currency.address,
  }
}

/**
 * Everything needed to transact on a NAMED chain, regardless of which edition is
 * running.
 *
 * The `require*` helpers below resolve from the ACTIVE edition, which is right
 * for anything tied to the session. The shop is not: a player picks which
 * currency to spend, so it needs the currency, marketplace and permit domain for
 * the chain they CHOSE, not the one their edition defaults to.
 *
 * Returns `null` for a chain Valor does not sell on, and every caller must treat
 * that as "cannot buy here" rather than substituting another chain's values.
 */
export function chainSpendConfig(chainId: number): {
  currency: `0x${string}`
  marketplace: `0x${string}`
  decimals: number
  symbol: string
  permit: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` }
} | null {
  const source = [WEB_EDITION].find((e) => e.chain.id === chainId)
  if (!source) return null

  const { currency, contracts } = source
  if (!currency.address || !currency.permit || !contracts.marketplace) return null

  return {
    currency: currency.address,
    marketplace: contracts.marketplace,
    decimals: currency.decimals,
    symbol: currency.symbol,
    permit: {
      name: currency.permit.name,
      version: currency.permit.version,
      chainId,
      // The token's OWN address, never a copy. A permit domain naming the wrong
      // verifying contract produces a signature that validates in the browser
      // and is rejected on-chain.
      verifyingContract: currency.address,
    },
  }
}

/**
 * The ERC-20 players spend in this edition, or a thrown error naming the reason.
 *
 * Replaces call sites that imported `G_TOKEN_ADDRESS` directly. That constant is
 * G$ on Celo and nothing else, so a hook using it while the active edition ran
 * on another chain would quote a price in one token and then try to move a token
 * with no deployment there.
 */
export function requireCurrencyAddress(): `0x${string}` {
  const { currency, id } = edition()
  if (!currency.address) {
    throw new Error(`The ${id} edition has no spend currency deployed, so nothing can be bought.`)
  }
  return currency.address
}

/**
 * ValorMarketplace on the active edition's chain, or a thrown error.
 *
 * Throws rather than returning a default for the reason spelled out on
 * `EditionContracts.marketplace`: substituting another chain's address produces a
 * transaction that reverts against an address holding no code, which reads to a
 * player as the app being broken and to a developer as nothing in particular.
 */
export function requireMarketplaceAddress(): `0x${string}` {
  const { contracts, id } = edition()
  if (!contracts.marketplace) {
    throw new Error(`The ${id} edition has no marketplace deployed, so buying is unavailable.`)
  }
  return contracts.marketplace
}

/**
 * `permitDomain()` or a thrown error naming the reason.
 *
 * For the signing hooks, which have no meaningful fallback: an edition without a
 * permit domain cannot complete a permit flow at all, and inventing one would
 * cost the player a signature and then revert. Failing loudly here is how that
 * surfaces as a bug report instead of a mysterious failed transaction.
 */
export function requirePermitDomain(): NonNullable<ReturnType<typeof permitDomain>> {
  const domain = permitDomain()
  if (!domain) {
    throw new Error(
      `The ${edition().id} edition has no permit-capable currency, so this action ` +
        `cannot be signed. It needs the approve-then-call path instead.`,
    )
  }
  return domain
}
