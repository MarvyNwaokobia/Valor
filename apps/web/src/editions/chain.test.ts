import { describe, expect, it, beforeEach } from 'vitest'
import { celo } from 'viem/chains'
import { G_TOKEN_ADDRESS } from '@/lib/constants'
import { __resetEditionForTests } from './index'
import { activeChain, activeChainId, permitDomain } from './chain'

/**
 * These pin the values that were previously written as literals across the
 * signing hooks, so the refactor that replaced them is provably behaviour-
 * preserving rather than merely believed to be.
 *
 * They matter more than most tests here. A permit signed against a wrong domain
 * verifies happily on the client and then reverts on-chain, after the player has
 * already approved it — so the failure lands in production, on real money, and
 * looks like "the marketplace is broken" rather than like a typo.
 */
describe('active chain resolution', () => {
  beforeEach(() => {
    __resetEditionForTests()
  })

  it('resolves to Celo for the default (web) edition', () => {
    expect(activeChain()).toBe(celo)
    expect(activeChainId()).toBe(42220)
  })

  it('produces exactly the G$ permit domain the hooks used to inline', () => {
    // The literal that was written into useResale, useDebt, useDuels,
    // useSurvivalRearm, useMarketplace and useTransferOut before this existed.
    expect(permitDomain()).toEqual({
      name: 'GoodDollar',
      version: '1',
      chainId: 42220,
      verifyingContract: G_TOKEN_ADDRESS,
    })
  })

  it('gives the verifying contract as the currency address, not a copy', () => {
    // Guards the drift this refactor exists to prevent: a second literal of the
    // token address living in the edition config and silently going stale.
    expect(permitDomain()?.verifyingContract).toBe(G_TOKEN_ADDRESS)
  })
})
