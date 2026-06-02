import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { XP_PER_RANK, RANK_G_REWARD, XP_WIN, XP_LOSS } from '@/lib/constants'
import { getRankUpgrade } from '@/utils/decay'
import type { Player, BattleMove, RoundData } from '@/types'
import { supabase } from '@/lib/supabase'
import { selectBotMove, calcDamage, generateBotStats } from '@/utils/battle'

export type BattlePhase = 'idle' | 'fighting' | 'result'

export interface BattleRoundResult {
  round: number
  playerMove: BattleMove
  botMove: BattleMove
  playerDmg: number
  botDmg: number
  playerHp: number
  botHp: number
}

export interface BattleResultState {
  won: boolean
  xpAwarded: number
  newXp: number
  rankedUp: boolean
  newRank: Player['rank'] | null
  gAwarded: number
  rounds: BattleRoundResult[]
}

export function useBattle(player: Player, walletAddress: string) {
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)
  const [phase, setPhase] = useState<BattlePhase>('idle')
  const [playerHp, setPlayerHp] = useState(100)
  const [botHp, setBotHp] = useState(100)
  const [round, setRound] = useState(1)
  const [log, setLog] = useState<BattleRoundResult[]>([])
  const [specialUsed, setSpecialUsed] = useState(false)
  const [botSpecialUsed, setBotSpecialUsed] = useState(false)
  const [result, setResult] = useState<BattleResultState | null>(null)
  const [botStats] = useState(() => generateBotStats(player.rank))

  function startBattle() {
    setPhase('fighting')
    setPlayerHp(100)
    setBotHp(100)
    setRound(1)
    setLog([])
    setSpecialUsed(false)
    setBotSpecialUsed(false)
    setResult(null)
  }

  const { mutateAsync: finalizeBattle } = useMutation({
    mutationFn: async ({
      won,
      rounds,
      finalPlayerHp,
      finalBotHp,
    }: {
      won: boolean
      rounds: BattleRoundResult[]
      finalPlayerHp: number
      finalBotHp: number
    }) => {
      const xp = won ? XP_WIN : XP_LOSS
      const prevXp = player.xp
      const rawNewXp = prevXp + xp
      const rankedUp = rawNewXp >= XP_PER_RANK
      const newXp = rankedUp ? rawNewXp - XP_PER_RANK : rawNewXp
      const newRank = rankedUp ? getRankUpgrade(player.rank) : null
      const gAwarded = rankedUp && newRank ? RANK_G_REWARD[newRank] : 0

      const wins = won ? player.wins + 1 : player.wins
      const losses = !won ? player.losses + 1 : player.losses
      const now = new Date().toISOString()

      // Persist to DB
      await supabase.from('battles').insert({
        challenger_wallet: walletAddress,
        opponent_wallet: 'bot',
        winner_wallet: won ? walletAddress : 'bot',
        rounds_data: rounds as never,
        xp_awarded_challenger: xp,
        xp_awarded_opponent: 0,
        is_bot: true,
      })

      const playerUpdates: Partial<Player> = {
        xp: newXp,
        wins,
        losses,
        last_active: now,
        decay_status: 'none',
      }
      if (newRank) {
        playerUpdates.rank = newRank
        playerUpdates.g_earned_lifetime = player.g_earned_lifetime + gAwarded
      }

      await supabase.from('players').update(playerUpdates).eq('wallet_address', walletAddress)
      updatePlayer(playerUpdates)

      // If ranked up, notify backend to trigger G$ distribution
      if (rankedUp && newRank) {
        fetch(`${import.meta.env.VITE_API_URL}/players/${walletAddress}/rank-up`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_rank: newRank }),
        }).catch(console.error) // fire and forget
      }

      return { won, xpAwarded: xp, newXp, rankedUp, newRank, gAwarded, rounds }
    },
  })

  async function handleMove(move: BattleMove) {
    if (phase !== 'fighting') return
    if (move === 'special' && specialUsed) return

    const botMove = selectBotMove(botSpecialUsed)
    if (botMove === 'special') setBotSpecialUsed(true)
    if (move === 'special') setSpecialUsed(true)

    const playerDmg = calcDamage(player.attack_stat, botStats.defense, move, botMove)
    const botDmg = calcDamage(botStats.attack, player.defense_stat, botMove, move)

    const newBotHp = Math.max(0, botHp - playerDmg)
    const newPlayerHp = Math.max(0, playerHp - botDmg)

    const roundEntry: BattleRoundResult = {
      round,
      playerMove: move,
      botMove,
      playerDmg,
      botDmg,
      playerHp: newPlayerHp,
      botHp: newBotHp,
    }

    const newLog = [...log, roundEntry]
    setLog(newLog)
    setPlayerHp(newPlayerHp)
    setBotHp(newBotHp)

    const isLastRound = round >= 5 || newBotHp <= 0 || newPlayerHp <= 0

    if (isLastRound) {
      setPhase('result')
      const won = newPlayerHp >= newBotHp
      const finalResult = await finalizeBattle({
        won,
        rounds: newLog,
        finalPlayerHp: newPlayerHp,
        finalBotHp: newBotHp,
      })
      setResult(finalResult)
    } else {
      setRound((r) => r + 1)
    }
  }

  function reset() {
    setPhase('idle')
    setResult(null)
  }

  return {
    phase,
    playerHp,
    botHp,
    round,
    log,
    specialUsed,
    result,
    botStats,
    startBattle,
    handleMove,
    reset,
  }
}
