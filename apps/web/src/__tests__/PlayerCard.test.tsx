import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Player } from '@/types'
import PlayerCard from '@/components/player-card/PlayerCard'

// Mock hooks that need network/wallet
vi.mock('@/hooks/useGBalance', () => ({ useGBalance: () => ({ formatted: '12.50 G$' }) }))
vi.mock('@/hooks/useAchievements', () => ({
  useAchievements: () => ({ achievements: [], loading: false }),
}))
vi.mock('@/components/player-card/AchievementSlots', () => ({
  default: () => <div data-testid="achievement-slots" />,
}))
vi.mock('@/components/player-card/DecayOverlay', () => ({
  default: () => <div data-testid="decay-overlay" />,
}))

const basePlayer: Player = {
  wallet_address:          '0xdeadbeef',
  play_style:              'Fighter',
  avatar:                  '⚔️',
  character_name:          'IronBlade',
  username:                null,
  display_name:            null,
  character_class:         'Berserker',
  character_customization: {},
  rank:                    'Bronze',
  xp:                      250,
  attack_stat:             16,
  defense_stat:            7,
  speed_stat:              9,
  g_earned_lifetime:       5,
  last_active:             new Date().toISOString(),
  decay_status:            'none',
  decay_frozen_until:      null,
  wins:                    3,
  losses:                  1,
  character_claim_tx:      null,
  created_at:              new Date().toISOString(),
}

describe('PlayerCard', () => {
  it('renders character name', () => {
    render(<PlayerCard player={basePlayer} />)
    expect(screen.getByText('IronBlade')).toBeTruthy()
  })

  it('renders rank badge', () => {
    render(<PlayerCard player={basePlayer} />)
    expect(screen.getByText('BRONZE')).toBeTruthy()
  })

  it('renders class chip', () => {
    render(<PlayerCard player={basePlayer} />)
    expect(screen.getByText('Berserker')).toBeTruthy()
  })

  it('renders win/loss counts', () => {
    render(<PlayerCard player={basePlayer} />)
    expect(screen.getByText('3W')).toBeTruthy()
    expect(screen.getByText('1L')).toBeTruthy()
  })

  it('renders stat values', () => {
    render(<PlayerCard player={basePlayer} />)
    expect(screen.getByText('16')).toBeTruthy()  // attack
    expect(screen.getByText('7')).toBeTruthy()   // defense
    expect(screen.getByText('9')).toBeTruthy()   // speed
  })

  it('shows decay overlay when last_active is >72h ago', () => {
    const pastDate = new Date(Date.now() - 80 * 3600 * 1000).toISOString()
    const decayingPlayer = { ...basePlayer, last_active: pastDate, decay_status: 'active' as const }
    render(<PlayerCard player={decayingPlayer} />)
    expect(screen.getByTestId('decay-overlay')).toBeTruthy()
  })

  it('does not show decay overlay when status is none', () => {
    render(<PlayerCard player={basePlayer} />)
    expect(screen.queryByTestId('decay-overlay')).toBeNull()
  })

  it('shows win rate when player has battles', () => {
    render(<PlayerCard player={basePlayer} />)
    expect(screen.getByText('75%')).toBeTruthy()
  })

  it('hides win rate when player has no battles', () => {
    const freshPlayer = { ...basePlayer, wins: 0, losses: 0 }
    render(<PlayerCard player={freshPlayer} />)
    expect(screen.queryByText('Win Rate')).toBeNull()
  })
})
