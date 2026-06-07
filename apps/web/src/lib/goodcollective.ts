import { GoodCollectiveSDK } from '@gooddollar/goodcollective-sdk'
import { ethers } from 'ethers'
import type { Rank } from '@/types/database'

const CELO_CHAIN_ID = '42220' as const
const CELO_RPC = 'https://forno.celo.org'

// One UBI pool per rank tier — create these at goodcollective.xyz then set env vars.
// Bronze has no pool (it's the starting rank). Silver+ earn streamable G$.
export const RANK_POOL_ADDRESSES: Partial<Record<Rank, `0x${string}`>> = {
  Silver:   (process.env.NEXT_PUBLIC_RANK_POOL_SILVER   ?? '') as `0x${string}`,
  Gold:     (process.env.NEXT_PUBLIC_RANK_POOL_GOLD     ?? '') as `0x${string}`,
  Platinum: (process.env.NEXT_PUBLIC_RANK_POOL_PLATINUM ?? '') as `0x${string}`,
  Diamond:  (process.env.NEXT_PUBLIC_RANK_POOL_DIAMOND  ?? '') as `0x${string}`,
}

export function rankPoolAddress(rank: Rank): `0x${string}` | null {
  const addr = RANK_POOL_ADDRESSES[rank]
  return addr && addr.length > 2 ? addr : null
}

// Singleton read SDK — uses a public Celo RPC, no signer required
let _readSDK: GoodCollectiveSDK | null = null
export function getReadSDK(): GoodCollectiveSDK {
  if (!_readSDK) {
    const provider = new ethers.providers.JsonRpcProvider(CELO_RPC)
    _readSDK = new GoodCollectiveSDK(CELO_CHAIN_ID, provider)
  }
  return _readSDK
}

// Minimal ABI for claiming from a GoodCollective UBI pool
export const UBI_POOL_CLAIM_ABI = [
  {
    name: 'claim',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
