import { describe, it, expect } from 'vitest'
import { calcDamage, selectBotMove, simulateBattle } from '@/utils/battle'

describe('calcDamage', () => {
  it('returns at least 1', () => {
    // Equal stats, no special, no defend — result is bounded ≥1
    for (let i = 0; i < 30; i++) {
      expect(calcDamage(10, 10, 'attack', 'attack')).toBeGreaterThanOrEqual(1)
    }
  })

  it('special attack hits harder than normal attack on average', () => {
    const normalSamples = Array.from({ length: 100 }, () => calcDamage(10, 10, 'attack', 'attack'))
    const specialSamples = Array.from({ length: 100 }, () => calcDamage(10, 10, 'special', 'attack'))
    const normalAvg = normalSamples.reduce((a, b) => a + b, 0) / normalSamples.length
    const specialAvg = specialSamples.reduce((a, b) => a + b, 0) / specialSamples.length
    expect(specialAvg).toBeGreaterThan(normalAvg)
  })

  it('defending halves the damage', () => {
    const normalSamples = Array.from({ length: 100 }, () => calcDamage(10, 10, 'attack', 'attack'))
    const defendSamples = Array.from({ length: 100 }, () => calcDamage(10, 10, 'attack', 'defend'))
    const normalAvg = normalSamples.reduce((a, b) => a + b, 0) / normalSamples.length
    const defendAvg = defendSamples.reduce((a, b) => a + b, 0) / defendSamples.length
    // Defend reduces damage by ~50%, allow ±30% margin for variance
    expect(defendAvg).toBeLessThan(normalAvg * 0.75)
  })

  it('higher attack stat beats lower defense stat', () => {
    const strongSamples = Array.from({ length: 50 }, () => calcDamage(25, 5, 'attack', 'attack'))
    const weakSamples   = Array.from({ length: 50 }, () => calcDamage(5, 25, 'attack', 'attack'))
    const strongAvg = strongSamples.reduce((a, b) => a + b, 0) / strongSamples.length
    const weakAvg   = weakSamples.reduce((a, b) => a + b, 0)   / weakSamples.length
    expect(strongAvg).toBeGreaterThan(weakAvg)
  })
})

describe('selectBotMove', () => {
  it('never returns special when specialUsed=true', () => {
    for (let i = 0; i < 200; i++) {
      expect(selectBotMove(true)).not.toBe('special')
    }
  })

  it('can return any valid move', () => {
    const moves = new Set<string>()
    for (let i = 0; i < 200; i++) moves.add(selectBotMove(false))
    expect(moves.has('attack')).toBe(true)
    expect(moves.has('defend')).toBe(true)
    expect(moves.has('special')).toBe(true)
  })

  it('returns only valid BattleMove values', () => {
    const valid = new Set(['attack', 'defend', 'special'])
    for (let i = 0; i < 100; i++) {
      expect(valid.has(selectBotMove(false))).toBe(true)
    }
  })
})

describe('simulateBattle', () => {
  const challengerStats = { attack: 12, defense: 10 }
  const opponentStats   = { attack: 10, defense: 12 }

  it('produces consistent results with a fixed seed', () => {
    const result1 = simulateBattle(challengerStats, opponentStats, 42)
    const result2 = simulateBattle(challengerStats, opponentStats, 42)
    expect(result1.winnerIsChallenger).toBe(result2.winnerIsChallenger)
    expect(result1.rounds.length).toBe(result2.rounds.length)
  })

  it('runs at most BATTLE_ROUNDS rounds', () => {
    for (let seed = 0; seed < 20; seed++) {
      const result = simulateBattle(challengerStats, opponentStats, seed)
      expect(result.rounds.length).toBeLessThanOrEqual(5)
      expect(result.rounds.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('HP never goes below 0 at end of any round', () => {
    const result = simulateBattle(challengerStats, opponentStats, 7)
    for (const r of result.rounds) {
      expect(r.challenger_hp_remaining).toBeGreaterThanOrEqual(0)
      expect(r.opponent_hp_remaining).toBeGreaterThanOrEqual(0)
    }
  })

  it('final HP matches final round remaining HP', () => {
    const result = simulateBattle(challengerStats, opponentStats, 13)
    const last = result.rounds[result.rounds.length - 1]
    expect(result.challengerHpFinal).toBe(last.challenger_hp_remaining)
    expect(result.opponentHpFinal).toBe(last.opponent_hp_remaining)
  })

  it('winner has higher or equal HP', () => {
    for (let seed = 0; seed < 50; seed++) {
      const result = simulateBattle(challengerStats, opponentStats, seed)
      if (result.winnerIsChallenger) {
        expect(result.challengerHpFinal).toBeGreaterThanOrEqual(result.opponentHpFinal)
      } else {
        expect(result.opponentHpFinal).toBeGreaterThanOrEqual(result.challengerHpFinal)
      }
    }
  })
})
