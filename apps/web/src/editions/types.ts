/**
 * @module editions/types
 * @description The contract every edition of Valor must satisfy.
 *
 * Valor ships through three "doors": the open web (playvalor.app in a normal
 * browser), inside MiniPay's in-app browser, and on Avalanche. All three are
 * ONE app on ONE domain from ONE build — the app looks around at startup and
 * decides which edition it is. Nothing here forks the game.
 *
 * THE RULE THAT KEEPS THIS FROM BECOMING THREE FORKS:
 *   editions/* may import from engine/, components/, hooks/, lib/.
 *   NOTHING outside editions/ may import from editions/<name>/ directly —
 *   it goes through `editions/index.ts` only.
 * Break that rule and you have three divergent games to patch, which is the
 * exact failure this module exists to prevent.
 *
 * ONE EXCEPTION: app/providers.tsx, the composition root. Wiring providers is
 * by definition the place that knows every edition exists, and it must import
 * the component itself rather than a re-export so that 'use client' code never
 * leaks into a server bundle through editions/index.ts.
 */

export type EditionId = 'web' | 'minipay' | 'avalanche'

/** How the player's wallet gets attached. */
export type AuthMode =
  /** Magic embedded wallet + optional injected. The current playvalor.app path. */
  | 'magic'
  /** The host wallet is already there and auto-connects. No sign-in screen at all. */
  | 'host-injected'
  /** Player brings their own wallet via the injected connector. */
  | 'byo-wallet'

/** Who vouches that a player is a unique human. */
export type IdentityMode =
  /** GoodDollar whitelist. Gates earning. Celo only. */
  | 'gooddollar'
  /** Nobody. Fine when the edition pays out nothing. */
  | 'none'

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
   * `null` where the edition cannot sign typed data anyway (MiniPay) or has no
   * currency deployed yet (Avalanche).
   */
  permit: { name: string; version: string } | null
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
   * The server is the authority on this — see the note in this file's README.
   * The client value only decides what UI to render. A browser claiming to be
   * an edition it isn't must never be able to unlock a payout.
   */
  earning: boolean

  /** What players spend in the marketplace. */
  currency: EditionCurrency

  /**
   * Can the wallet sign EIP-712 typed data?
   *
   * MiniPay cannot: `personal_sign` and `eth_signTypedData` are unsupported.
   * Every permit-based flow (marketplace purchase, resale, transfer out,
   * duels, rearm) has to fall back to approve-then-call when this is false.
   */
  canSignTypedData: boolean

  /**
   * Root path for game assets. Lets an edition point at compressed variants
   * without any call site knowing. All editions are served from the same
   * `public/` folder, so this selects a subfolder, it does not isolate a deploy.
   */
  assetBase: string

  features: {
    campaign: boolean
    endless: boolean
    /**
     * Endless is normally gated behind clearing campaign level 15
     * (ENDLESS_UNLOCK_LEVEL in engine/campaign/levels.ts). Editions whose
     * players arrive with three spare minutes should open it immediately.
     */
    endlessRequiresCampaignClear: boolean
    marketplace: boolean
    /** Bank, withdraw, transfer out. Meaningless when earning is off. */
    bank: boolean
    dailyClaim: boolean
    duels: boolean
    /** Bloom and post-processing. Expensive on budget Android GPUs. */
    postProcessing: boolean
    cinematics: boolean
  }

  /**
   * Copy rules the edition's host enforces on user-facing strings.
   * MiniPay rejects "gas", "crypto", "onramp" and "offramp" at listing review.
   */
  copyRules?: Record<string, string>
}
