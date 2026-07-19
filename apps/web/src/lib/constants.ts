export const CELO_CHAIN_ID = 42220
export const CELO_ALFAJORES_CHAIN_ID = 44787

export const G_TOKEN_ADDRESS = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' as const
export const SUPERFLUID_CFA_FORWARDER = '0xcfA132E353cB4E398080B9700609bb008eceB125' as const

export const RANKS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond'] as const
export type Rank = (typeof RANKS)[number]

export const RANK_COLORS: Record<Rank, string> = {
  Iron: '#8a8f98',
  Bronze: '#cd7f32',
  Silver: '#c0c0c0',
  Gold: '#ffd700',
  Platinum: '#e5e4e2',
  Emerald: '#34d399',
  Diamond: '#b9f2ff',
}

// G$ for REACHING a rank — it GROWS with the rank (500 more each step): the higher you
// climb, the bigger the payout. Mirrors the server's rank_up_reward_g (STEP × ordinal)
// in apps/api battles.rs. Iron is the start (never reached via a rank-up).
export const RANK_G_REWARD: Record<Rank, number> = {
  Iron: 500,       // unused (you start here)
  Bronze: 500,     // 1st rank-up
  Silver: 1000,    // 2nd
  Gold: 1500,      // 3rd
  Platinum: 2000,  // 4th
  Emerald: 2500,   // 5th
  Diamond: 3000,   // 6th
}

// XP to rank up (fill the bar). Kills drive it, so a bigger bar = a longer climb.
// MUST match XP_PER_RANK in apps/api battles.rs.
export const XP_PER_RANK = 5000
export const XP_WIN = 100
export const XP_LOSS = 30
export const XP_IDLE_COLLECT = 50
export const DAILY_CLAIM_G = 5

export const BATTLE_ROUNDS = 5
export const MISSION_DURATION_MS = 30 * 60 * 1000 // 30 minutes
export const DECAY_WARNING_HOURS = 48
export const DECAY_PENALIZE_HOURS = 72
export const DECAY_FREEZE_DAYS = 7

export const ITEM_RARITY_COLORS = {
  common: '#9ca3af',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#eab308',
} as const

export const PLAY_STYLES = ['Wanderer', 'Fighter', 'Champion'] as const
export type PlayStyle = (typeof PLAY_STYLES)[number]
