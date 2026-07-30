/**
 * @module editions/minipay/config
 * @description Valor inside MiniPay's in-app browser.
 *
 * Same chain as web (Celo), same domain, same build. What differs:
 *
 *   - NO EARNING. Playing pays an in-game balance, never redeemable currency.
 *     This removes the reward pool, the payout relay, the sybil surface and
 *     the GoodDollar dependency in one move.
 *   - NO GOODDOLLAR IDENTITY. Nothing to gate, because nothing pays out.
 *     Onboarding is: open MiniPay, tap Valor, play.
 *   - REAL STABLECOINS TO BUY. Players spend USDm/USDC/USDT on marketplace
 *     goods. This is the first Valor surface that takes money in rather than
 *     paying it out.
 *   - NO TYPED-DATA SIGNING. MiniPay does not support `personal_sign` or
 *     `eth_signTypedData`, so every permit flow needs an approve-then-call
 *     fallback. See ./README.md.
 *
 * Both campaign and endless ship. Endless is ungated here: a MiniPay player
 * has three minutes, not fifteen campaign levels.
 */

import type { EditionConfig } from '../types'

/**
 * Mento Dollar (USDm, formerly cUSD) on Celo. 18 decimals.
 * Verified against docs.celo.org via the celopedia contracts reference.
 *
 * MiniPay's allowed token scope is USDm / USDC / USDT only. USDC and USDT are
 * 6 decimals, NOT 18 — when multi-token spend lands, read decimals per token
 * rather than assuming this one.
 */
const USDM = '0x765DE816845861e75A25fCA122bb6898B8B1282a' as const

export const MINIPAY_EDITION: EditionConfig = {
  id: 'minipay',

  chain: {
    id: 42220,
    rpcUrl: process.env.NEXT_PUBLIC_CELO_RPC_URL ?? 'https://forno.celo.org',
  },

  // MiniPay injects a wallet that is already unlocked and already funded.
  // There is no sign-in screen, no modal, no connect button.
  auth: 'host-injected',
  identity: 'none',
  earning: false,

  currency: {
    symbol: 'USDm',
    address: USDM,
    decimals: 18,
    redeemable: false, // spend-only: goods in, no cash-out path
  },

  // The constraint that costs the most code. Do not flip this hopefully.
  canSignTypedData: false,

  // Compressed asset variants live under this prefix. Same `public/` folder as
  // every other edition (one domain, one deploy) — this selects which files
  // get REQUESTED, which is the only thing that reaches a player's phone.
  assetBase: '/lite/',

  features: {
    campaign: true,
    endless: true,
    // The single most important line in this file. ENDLESS_UNLOCK_LEVEL = 15
    // would otherwise bury the best-fitting mode behind the whole campaign.
    endlessRequiresCampaignClear: false,
    marketplace: true,
    bank: false,
    dailyClaim: false,
    duels: false, // duels sign typed data; revisit after the approve-then-call work
    postProcessing: false, // budget Android GPUs
    cinematics: false, // never make a wallet user sit through a cutscene
  },

  /**
   * MiniPay rejects these words in user-facing strings at listing review.
   * Applies to labels, tooltips and error messages — NOT to code identifiers
   * or RPC method names (`gasEstimate`, `feeCurrency` stay as they are).
   */
  copyRules: {
    gas: 'network fee',
    'gas fee': 'network fee',
    onramp: 'deposit',
    'buy crypto': 'deposit',
    offramp: 'withdraw',
    'sell crypto': 'withdraw',
    crypto: 'stablecoin',
  },
}
