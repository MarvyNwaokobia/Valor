/**
 * @module editions/avalanche/config
 * @description Valor on Avalanche C-Chain (43114).
 *
 * DEPLOY TARGET: the public C-Chain, not a Valor L1. That was considered and set
 * aside: an L1 gives free gas and the strongest Retro9000 fit, but it needs
 * validators, its own RPC servers, an explorer and a chain id nobody has claimed,
 * which is weeks. The C-Chain already exists, so contracts can be live in days.
 * The cost of that choice is that gas is AVAX, which has to be bought, so the
 * relay-runs-dry failure that breaks Celo payouts exists here too and the relay
 * needs monitoring from day one.
 *
 * CURRENCY: Scrip (SCRP), an ERC-20 that Valor mints. It is NOT redeemable, and
 * that is load-bearing rather than a limitation. GoodDollar lives on Celo and
 * Fuse, so there is no proof-of-unique-human available here; if SCRP could be
 * sold, one person farming fifty wallets would be worth doing immediately.
 * Because it cannot be sold, it is not. The exit (a SCRP→AVAX swap in the Bank)
 * must be funded from real revenue and sit behind an identity gate before it
 * opens. See services/chain_id.rs, which holds the same rule server-side, where
 * it actually binds.
 *
 * IDENTITY: `magic`, deliberately NOT `byo-wallet`. EVM addresses are the same on
 * every chain, so a player signing in with Magic gets the SAME address here as on
 * Celo, which means the same row in `players` and therefore the same rank, XP and
 * campaign progress. Switching to a bring-your-own wallet would hand them a
 * different address and split one human into two unrelated players.
 */

import type { EditionConfig } from '../types'

export const AVALANCHE_EDITION: EditionConfig = {
  id: 'avalanche',

  chain: {
    id: 43114, // Avalanche C-Chain mainnet
    rpcUrl:
      process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ??
      'https://avalanche.api.onfinality.io/public/ext/bc/C/rpc',
  },

  // Same sign-in as the web edition, so the player keeps one address and one
  // identity across both chains. See the note above.
  auth: 'magic',
  // No GoodDollar off Celo. Safe only for as long as `earning` stays false.
  identity: 'none',

  // Playing does not pay real, withdrawable money here. SCRP has no exit yet, so
  // there is nothing to farm. Do not flip this without a sybil answer shipping
  // alongside it.
  earning: false,

  currency: {
    symbol: 'SCRP',
    // Deployed 2026-08-02 on C-Chain, copied from DeployAvalanche.s.sol's output
    // and confirmed against Snowtrace. Hardcoded rather than read from env, the
    // same way lib/constants.ts holds G_TOKEN_ADDRESS: a mainnet token address is
    // a fixed fact, and one fewer environment variable is one fewer thing that can
    // be set wrong in a deploy dashboard.
    address: '0x9e3cFd517111D6d458e0Aa51deCAC66413388537',
    decimals: 18,
    // No cash-out path, so Bank withdraw and transfer-out stay hidden.
    redeemable: false,
    // Scrip's own EIP-712 domain, from `ERC20Permit("Scrip")` in Scrip.sol.
    // NOT G$'s — a mismatched domain produces a signature that verifies in the
    // browser and then reverts on-chain, which is the worst kind of bug to chase.
    permit: { name: 'Scrip', version: '1' },
  },

  contracts: {
    // ValorMarketplace on C-Chain, deployed 2026-08-02, initialised with Scrip in
    // the currency slot the Celo deployment gives to G$. Pinned here rather than
    // read from NEXT_PUBLIC_MARKETPLACE_CONTRACT, which is Celo's: one global
    // address across two chains would have players signing permits against a
    // contract that does not exist on the chain they are transacting on.
    marketplace: '0x751fBFFFc9419BC825645cD69661e51Ae2D529f6',
  },

  // Standard EVM wallets sign typed data fine, so the permit flows work as-is and
  // none of MiniPay's approve-then-call fallbacks are needed here.
  canSignTypedData: true,

  assetBase: '/',

  features: {
    campaign: true,
    endless: true,
    // Avalanche players arrive from a gaming ecosystem and should not have to
    // clear 15 campaign ops before the mode built for them opens.
    endlessRequiresCampaignClear: false,
    marketplace: true,
    // Meaningless while earning is off: nothing to bank, nothing to withdraw.
    bank: false,
    dailyClaim: false,
    // The reason to be on this chain. Value moves between players with a house
    // cut, so it needs no reward pool and creates no sybil surface.
    duels: true,
    postProcessing: true,
    cinematics: true,
  },
}
