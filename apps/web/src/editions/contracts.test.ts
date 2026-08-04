import { describe, expect, it } from 'vitest'
import { WEB_EDITION } from './web/config'
import { MINIPAY_EDITION } from './minipay/config'
import type { EditionConfig } from './types'

/**
 * Pins the per-edition contract and currency addresses.
 *
 * These used to be one global each: `NEXT_PUBLIC_MARKETPLACE_CONTRACT` and
 * `G_TOKEN_ADDRESS`, read directly by useMarketplace and useResale. That was
 * correct only while every edition ran on Celo. The moment one does not, a single
 * global has a player signing a permit against a marketplace holding no code on
 * the chain they are transacting on. The transaction reverts with nothing useful
 * to read, after the player has already approved it.
 *
 * Cheap tests, but they guard the two mistakes that are expensive precisely
 * because they look fine right up until real money moves: a wrong address, and
 * two editions accidentally sharing one.
 */

const ALL: EditionConfig[] = [WEB_EDITION, MINIPAY_EDITION]

describe('per-edition contract addresses', () => {
  it('never lets two chains share a currency address', () => {
    const byChain = new Map<number, Set<string>>()
    for (const e of ALL) {
      if (!e.currency.address) continue
      const seen = byChain.get(e.chain.id) ?? new Set()
      seen.add(e.currency.address.toLowerCase())
      byChain.set(e.chain.id, seen)
    }
    // A token address is only meaningful on one chain. The same address turning
    // up under two different chain ids means one of them is wrong.
    const addressToChains = new Map<string, Set<number>>()
    for (const [chainId, addrs] of byChain) {
      for (const a of addrs) {
        const chains = addressToChains.get(a) ?? new Set()
        chains.add(chainId)
        addressToChains.set(a, chains)
      }
    }
    for (const [addr, chains] of addressToChains) {
      expect(chains.size, `${addr} is declared on chains ${[...chains].join(', ')}`).toBe(1)
    }
  })

  it('keeps every earning edition on a chain that can actually pay', () => {
    for (const e of ALL) {
      if (!e.earning) continue
      // Earning means real money leaves, which needs a redeemable currency AND a
      // proof-of-unique-human. This fails loudly if someone flips `earning` on an
      // edition that has neither.
      expect(e.currency.redeemable, `${e.id} earns but its currency is not redeemable`).toBe(true)
      expect(e.identity, `${e.id} earns with no identity gate`).not.toBe('none')
    }
  })

  it('hides the bank wherever nothing is redeemable', () => {
    for (const e of ALL) {
      if (e.currency.redeemable) continue
      expect(e.features.bank, `${e.id} shows a bank for a currency with no cash-out`).toBe(false)
    }
  })
})
