/**
 * @module editions/avalanche/config
 * @description Valor on Avalanche C-Chain. NOT BUILT — scaffold only.
 *
 * Strategy note, because it drives everything below: Avalanche's gaming
 * community shows up for competition and ownership, not for redistribution.
 * So this edition should lean into stakes, tournaments and seasons rather
 * than mirroring the G$ earn loop, which cannot exist here anyway —
 * GoodDollar lives on Celo and Fuse, not Avalanche.
 *
 * That has a consequence worth stating plainly: dropping GoodDollar drops
 * Valor's only proof-of-unique-human. Any edition here that pays real value
 * out needs a different sybil answer BEFORE it ships, or one person farms it
 * from fifty wallets. Stake-based play (value moves between players, not from
 * a pool to players) sidesteps this, which is a second reason to prefer it.
 */

import type { EditionConfig } from '../types'

export const AVALANCHE_EDITION: EditionConfig = {
  id: 'avalanche',

  chain: {
    id: 43114, // Avalanche C-Chain mainnet
    rpcUrl:
      process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ??
      'https://api.avax.network/ext/bc/C/rpc',
  },

  auth: 'byo-wallet',
  identity: 'none',

  // Deliberately false until the sybil question above has an answer.
  earning: false,

  currency: {
    symbol: 'TBD',
    // NOT SET ON PURPOSE. Never guess a token address — wrong address means
    // lost funds. Fill this in from a deployment you performed or a source you
    // verified, not from memory.
    address: null,
    decimals: 18,
    redeemable: false,
    // Fill in from the deployed token's own EIP-712 domain, read off the
    // contract. Do not copy G$'s — a mismatched domain reverts on-chain.
    permit: null,
  },

  // Standard EVM wallets sign typed data fine, so the permit flows that
  // MiniPay forces us to rewrite can stay as they are here.
  canSignTypedData: true,

  assetBase: '/',

  features: {
    campaign: true,
    endless: true,
    endlessRequiresCampaignClear: false,
    marketplace: true,
    bank: false,
    dailyClaim: false,
    // The reason to be on this chain at all. Specced but never built.
    duels: true,
    postProcessing: true,
    cinematics: true,
  },
}
