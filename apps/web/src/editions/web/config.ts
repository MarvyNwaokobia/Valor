/**
 * @module editions/web/config
 * @description playvalor.app in a normal browser. The edition that exists today.
 *
 * This config describes CURRENT behaviour exactly. Nothing here is new — it is
 * the baseline the other two editions are diffs against, so if this file and
 * the running app ever disagree, this file is wrong.
 */

import { G_TOKEN_ADDRESS } from '@/lib/constants'
import type { EditionConfig } from '../types'

export const WEB_EDITION: EditionConfig = {
  id: 'web',

  chain: {
    id: 42220,
    rpcUrl: process.env.NEXT_PUBLIC_CELO_RPC_URL ?? 'https://forno.celo.org',
  },

  auth: 'magic',
  identity: 'gooddollar',

  // Note: gameplay earning is separately paused server-side via EARNING_PAUSED
  // (apps/api/src/services/earn_cap.rs). This flag says the edition HAS an
  // earning path at all, not that it is currently open.
  earning: true,

  currency: {
    symbol: 'G$',
    // Single source of truth. Do not re-declare the address here.
    address: G_TOKEN_ADDRESS,
    decimals: 18,
    redeemable: true,
    // Exactly what G$ expects. Pinned by a test in editions/chain.test.ts against
    // the literals these replaced, because a wrong permit domain produces a
    // signature that looks fine and then reverts on-chain.
    permit: { name: 'GoodDollar', version: '1' },
  },

  contracts: {
    // Celo marketplace, from env as it always was. Kept in env rather than
    // hardcoded because the Celo deployment has been upgraded before and may be
    // again; the Avalanche one is pinned in its own config.
    marketplace: (process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT ?? null) as `0x${string}` | null,
  },

  canSignTypedData: true,

  assetBase: '/',

  features: {
    campaign: true,
    endless: true,
    endlessRequiresCampaignClear: true,
    marketplace: true,
    bank: true,
    dailyClaim: true,
    duels: true,
    postProcessing: true,
    cinematics: true,
  },
}
