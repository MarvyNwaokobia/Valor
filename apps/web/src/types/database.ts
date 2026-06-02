export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Rank = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond'
export type PlayStyle = 'Wanderer' | 'Fighter' | 'Champion'
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export type ItemCategory = 'weapon' | 'shield' | 'booster'
export type BattleMove = 'attack' | 'defend' | 'special'

export interface Database {
  public: {
    Tables: {
      players: {
        Row: Player
        Insert: Omit<Player, 'created_at'>
        Update: Partial<Omit<Player, 'wallet_address' | 'created_at'>>
      }
      items: {
        Row: Item
        Insert: Omit<Item, 'id'>
        Update: Partial<Omit<Item, 'id'>>
      }
      inventory: {
        Row: InventoryItem
        Insert: InventoryItem
        Update: Partial<Pick<InventoryItem, 'equipped'>>
      }
      battles: {
        Row: Battle
        Insert: Omit<Battle, 'id' | 'created_at'>
        Update: never
      }
      missions: {
        Row: Mission
        Insert: Omit<Mission, 'id'>
        Update: Partial<Pick<Mission, 'collected' | 'item_dropped' | 'xp_awarded'>>
      }
      achievements: {
        Row: Achievement
        Insert: Achievement
        Update: never
      }
      player_achievements: {
        Row: PlayerAchievement
        Insert: PlayerAchievement
        Update: never
      }
      daily_claims: {
        Row: DailyClaim
        Insert: DailyClaim
        Update: Pick<DailyClaim, 'last_claimed_at'>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}

export interface Player {
  wallet_address: string
  play_style: PlayStyle
  avatar: string
  character_name: string
  rank: Rank
  xp: number
  attack_stat: number
  defense_stat: number
  speed_stat: number
  g_earned_lifetime: number
  last_active: string
  decay_status: 'none' | 'warning' | 'active'
  decay_frozen_until: string | null
  wins: number
  losses: number
  created_at: string
}

export interface Item {
  id: string
  name: string
  description: string
  rarity: Rarity
  category: ItemCategory
  stat_boost: number
  price_g: number
  image_url: string
  total_supply: number | null
  remaining_supply: number | null
}

export interface InventoryItem {
  wallet_address: string
  item_id: string
  equipped: boolean
  acquired_at: string
}

export interface RoundData {
  round: number
  challenger_move: BattleMove
  opponent_move: BattleMove
  challenger_damage: number
  opponent_damage: number
  challenger_hp_remaining: number
  opponent_hp_remaining: number
}

export interface Battle {
  id: string
  challenger_wallet: string
  opponent_wallet: string
  winner_wallet: string | null
  rounds_data: RoundData[]
  xp_awarded_challenger: number
  xp_awarded_opponent: number
  is_bot: boolean
  created_at: string
}

export interface Mission {
  id: string
  wallet_address: string
  deployed_at: string
  collect_by: string
  collected: boolean
  item_dropped: string | null
  xp_awarded: number
}

export interface Achievement {
  id: string
  name: string
  description: string
  condition: string
  image_url: string
}

export interface PlayerAchievement {
  wallet_address: string
  achievement_id: string
  unlocked_at: string
}

export interface DailyClaim {
  wallet_address: string
  last_claimed_at: string
}
