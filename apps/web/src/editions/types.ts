/**
 * @module editions/types
 * @description The shape of the edition config.
 *
 * Valor runs as one edition, `web`. The config stays a typed object so that the
 * chain, spend currency and contract addresses are read from one place instead of
 * being scattered through the call sites. Code outside editions/ asks `edition()`
 * and never imports editions/web directly.
 */

export type EditionId = 'web'

/** How the player's wallet gets attached. */
export type AuthMode =
  /** Magic embedded wallet + optional injected. The current playvalor.app path. */
  | 'magic'
  /** Player brings their own wallet via the injected connector. */
  | 'byo-wallet'

/** Who vouches that a player is a unique human. */
export type IdentityMode =
  /** GoodDollar whitelist. Gates earning. Celo only. */
  | 'gooddollar'

export interface EditionCurrency {
  /** Ticker shown to players. */
  symbol: string
  /** ERC-20 address, or null when the edition has no on-chain spend currency yet. */
  address: `0x${string}` | null
  decimals: number
  /**
   * False when this is a points/in-game balance with no cash-out path.
   * Drives whether Bank, Withdraw and Transfer Out render at all.
   */
  redeemable: boolean
  /**
   * EIP-712 domain identity for this token's EIP-2612 `permit`, when it has one.
   *
   * These are properties of the TOKEN, not the chain: G$ signs under
   * `{ name: 'GoodDollar', version: '1' }`, and a different token on a different
   * chain will not. Swapping only `chainId` would produce a domain the token
   * rejects, which surfaces as a signature that verifies locally and then
   * reverts on-chain — the worst kind of failure to debug.
   *
   * `null` for a currency with no permit.
   */
  permit: { name: string; version: string } | null
}

/** Valor's own contracts, per chain. */
export interface EditionContracts {
  /**
   * ValorMarketplace on this edition's chain.
   *
   * A per-edition value because Valor deploys its own marketplace to every chain
   * it runs on, at a DIFFERENT address each time. Reading it from a single
   * global (`NEXT_PUBLIC_MARKETPLACE_CONTRACT`) is fine only while every edition
   * is Celo, and silently wrong the moment one is not: a player would sign a
   * permit against a marketplace that does not exist on the chain they are
   * transacting on, and the transaction would revert with nothing useful to read.
   *
   * `null` means this edition has no marketplace deployed, and callers must
   * disable buying rather than fall back to another chain's address.
   */
  marketplace: `0x${string}` | null
}

export interface EditionConfig {
  id: EditionId

  chain: {
    id: number
    /** Read RPC. Writes go through whatever wallet the auth mode attached. */
    rpcUrl: string
  }

  auth: AuthMode
  identity: IdentityMode

  /**
   * Does playing pay real money out?
   *
   * The server is the authority on this (apps/api/src/services/edition.rs).
   * The client value only decides what UI to render. A browser claiming to be
   * an edition it isn't must never be able to unlock a payout.
   */
  earning: boolean

  /** What players spend in the marketplace. */
  currency: EditionCurrency

  /** Valor's own deployed contracts on this edition's chain. */
  contracts: EditionContracts
}
