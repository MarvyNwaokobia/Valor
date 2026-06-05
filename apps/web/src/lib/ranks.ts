import type { Rank } from '@/types/database'

export interface RankDefinition {
  rank: Rank
  label: string
  tier: number           // 1–5
  /** Base color for rank badge + accents */
  color: string
  /** Glow shadow string (CSS box-shadow fragment) */
  glow: string
  /** Aura enabled above this tier */
  hasAura: boolean
  /** Floating particles (Diamond only) */
  hasParticles: boolean
  /** Pulsing armor-light effect */
  armorLight: boolean
  badgeBg: string
  badgeText: string
}

export const RANK_DEFINITIONS: Record<Rank, RankDefinition> = {
  Bronze: {
    rank: 'Bronze',
    label: 'BRONZE',
    tier: 1,
    color: '#cd7f32',
    glow: '0 0 12px rgba(205,127,50,0.25)',
    hasAura: false,
    hasParticles: false,
    armorLight: false,
    badgeBg: 'rgba(205,127,50,0.12)',
    badgeText: '#cd7f32',
  },
  Silver: {
    rank: 'Silver',
    label: 'SILVER',
    tier: 2,
    color: '#c0c0c0',
    glow: '0 0 18px rgba(192,192,192,0.30), 0 0 40px rgba(192,192,192,0.10)',
    hasAura: true,
    hasParticles: false,
    armorLight: false,
    badgeBg: 'rgba(192,192,192,0.10)',
    badgeText: '#d0d0d0',
  },
  Gold: {
    rank: 'Gold',
    label: 'GOLD',
    tier: 3,
    color: '#eab308',
    glow: '0 0 24px rgba(234,179,8,0.50), 0 0 56px rgba(234,179,8,0.20)',
    hasAura: true,
    hasParticles: false,
    armorLight: true,
    badgeBg: 'rgba(234,179,8,0.15)',
    badgeText: '#fbbf24',
  },
  Platinum: {
    rank: 'Platinum',
    label: 'PLATINUM',
    tier: 4,
    color: '#e2e8f0',
    glow: '0 0 30px rgba(226,232,240,0.55), 0 0 70px rgba(226,232,240,0.25), 0 0 120px rgba(148,163,184,0.12)',
    hasAura: true,
    hasParticles: false,
    armorLight: true,
    badgeBg: 'rgba(226,232,240,0.12)',
    badgeText: '#f1f5f9',
  },
  Diamond: {
    rank: 'Diamond',
    label: 'DIAMOND',
    tier: 5,
    color: '#7dd3fc',
    glow: '0 0 40px rgba(125,211,252,0.65), 0 0 90px rgba(125,211,252,0.30), 0 0 160px rgba(125,211,252,0.12)',
    hasAura: true,
    hasParticles: true,
    armorLight: true,
    badgeBg: 'rgba(125,211,252,0.14)',
    badgeText: '#bae6fd',
  },
}

/** Roman numeral prestige suffix — future use beyond Diamond */
export function rankLabel(rank: Rank): string {
  return RANK_DEFINITIONS[rank]?.label ?? rank.toUpperCase()
}

/** Returns the CSS box-shadow string combining rank glow with class glow */
export function combinedGlow(rankColor: string, classGlow: string, tier: number): string {
  if (tier <= 1) return classGlow
  return `${classGlow}, ${RANK_DEFINITIONS[rankColor as Rank]?.glow ?? ''}`
}
