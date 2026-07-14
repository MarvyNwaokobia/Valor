export const CELO_CHAIN_ID = 42220
export const CELO_ALFAJORES_CHAIN_ID = 44787

export const G_TOKEN_ADDRESS = '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A' as const
export const SUPERFLUID_CFA_FORWARDER = '0xcfA132E353cB4E398080B9700609bb008eceB125' as const

export const RANKS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'] as const
export type Rank = (typeof RANKS)[number]

export const RANK_COLORS: Record<Rank, string> = {
  Bronze: '#cd7f32',
  Silver: '#c0c0c0',
  Gold: '#ffd700',
  Platinum: '#e5e4e2',
  Diamond: '#b9f2ff',
}

// Flat G$ paid for reaching a new rank (crossing XP_PER_RANK). Matches the
// server-authoritative RANK_UP_REWARD_G in apps/api battles.rs.
export const RANK_G_REWARD: Record<Rank, number> = {
  Bronze: 500,
  Silver: 500,
  Gold: 500,
  Platinum: 500,
  Diamond: 500,
}

export const XP_PER_RANK = 1000
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
