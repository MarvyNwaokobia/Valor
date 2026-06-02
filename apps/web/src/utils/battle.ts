import type { BattleMove, RoundData, Player } from '@/types'
import { BATTLE_ROUNDS } from '@/lib/constants'

const BOT_MOVE_WEIGHTS: Record<BattleMove, number> = {
  attack: 0.5,
  defend: 0.35,
  special: 0.15,
}

export function selectBotMove(specialUsed: boolean): BattleMove {
  if (specialUsed) {
    return Math.random() < BOT_MOVE_WEIGHTS.attack / (1 - BOT_MOVE_WEIGHTS.special)
      ? 'attack'
      : 'defend'
  }
  const roll = Math.random()
  if (roll < BOT_MOVE_WEIGHTS.attack) return 'attack'
  if (roll < BOT_MOVE_WEIGHTS.attack + BOT_MOVE_WEIGHTS.defend) return 'defend'
  return 'special'
}

export function calcDamage(
  attackerAttack: number,
  defenderDefense: number,
  move: BattleMove,
  opponentMove: BattleMove,
): number {
  const base = move === 'special' ? 40 : 20
  const variance = base * 0.2 * (Math.random() * 2 - 1)
  const statModifier = 1 + (attackerAttack - defenderDefense) * 0.01
  const defenseMultiplier = opponentMove === 'defend' ? 0.5 : 1

  return Math.max(1, Math.round((base + variance) * statModifier * defenseMultiplier))
}

interface BotStats {
  attack: number
  defense: number
  speed: number
}

export function generateBotStats(playerRank: Player['rank']): BotStats {
  const rankBase: Record<Player['rank'], number> = {
    Bronze: 10,
    Silver: 15,
    Gold: 20,
    Platinum: 25,
    Diamond: 30,
  }
  const base = rankBase[playerRank]
  const variance = Math.floor(Math.random() * 5) - 2
  return {
    attack: base + variance,
    defense: base + variance,
    speed: base + variance,
  }
}

export interface BattleResult {
  rounds: RoundData[]
  winnerIsChallenger: boolean
  challengerHpFinal: number
  opponentHpFinal: number
}

export function simulateBattle(
  challenger: { attack: number; defense: number },
  opponent: { attack: number; defense: number },
  seed?: number,
): BattleResult {
  // Deterministic simulation via seeded random
  let rngState = seed ?? Date.now()
  const rng = () => {
    rngState = (rngState * 1664525 + 1013904223) & 0xffffffff
    return (rngState >>> 0) / 0xffffffff
  }

  const MAX_HP = 100
  let challengerHp = MAX_HP
  let opponentHp = MAX_HP
  let challengerSpecialUsed = false
  let opponentSpecialUsed = false
  const rounds: RoundData[] = []

  for (let round = 1; round <= BATTLE_ROUNDS; round++) {
    // Simple bot-style move selection for async battles
    const cRoll = rng()
    let challengerMove: BattleMove = 'attack'
    if (!challengerSpecialUsed && cRoll > 0.85) {
      challengerMove = 'special'
      challengerSpecialUsed = true
    } else if (cRoll > 0.5) {
      challengerMove = 'defend'
    }

    const oRoll = rng()
    let opponentMove: BattleMove = 'attack'
    if (!opponentSpecialUsed && oRoll > 0.85) {
      opponentMove = 'special'
      opponentSpecialUsed = true
    } else if (oRoll > 0.5) {
      opponentMove = 'defend'
    }

    const challengerDmg = calcDamage(
      challenger.attack,
      opponent.defense,
      challengerMove,
      opponentMove,
    )
    const opponentDmg = calcDamage(opponent.attack, challenger.defense, opponentMove, challengerMove)

    opponentHp = Math.max(0, opponentHp - challengerDmg)
    challengerHp = Math.max(0, challengerHp - opponentDmg)

    rounds.push({
      round,
      challenger_move: challengerMove,
      opponent_move: opponentMove,
      challenger_damage: challengerDmg,
      opponent_damage: opponentDmg,
      challenger_hp_remaining: challengerHp,
      opponent_hp_remaining: opponentHp,
    })

    if (challengerHp <= 0 || opponentHp <= 0) break
  }

  return {
    rounds,
    winnerIsChallenger: challengerHp >= opponentHp,
    challengerHpFinal: challengerHp,
    opponentHpFinal: opponentHp,
  }
}
