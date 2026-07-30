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
 * Making those follow the active edition would point an Avalanche session at
 * contracts that do not exist on Avalanche. `lib/constants.ts` keeps
 * `CELO_CHAIN_ID` for exactly this reason: it names Celo on purpose.
 */

import { avalanche, celo, type Chain } from 'viem/chains'
import { edition } from './index'

/** Every chain any edition can run on, by chain id. */
const CHAINS: Record<number, Chain> = {
  [celo.id]: celo,
  [avalanche.id]: avalanche,
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
 * The EIP-712 domain for the active edition's currency `permit`.
 *
 * Returns `null` when the edition has no permit-capable currency — MiniPay,
 * which cannot sign typed data at all, and Avalanche, which has no token
 * deployed. Callers must treat `null` as "this edition does not do permits" and
 * take their non-signature path rather than substituting a default. Guessing a
 * domain produces a signature that verifies locally and reverts on-chain.
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
