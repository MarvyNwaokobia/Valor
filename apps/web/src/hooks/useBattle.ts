import { useState, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useMarketplaceItems } from '@/hooks/useMarketplace'
import { useAchievements } from '@/hooks/useAchievements'
import { XP_PER_RANK, RANK_G_REWARD, XP_WIN, XP_LOSS } from '@/lib/constants'
import { getRankUpgrade } from '@/utils/decay'
import type { Player, BattleMove, RoundData } from '@/types'
import { supabase } from '@/lib/supabase'
import { selectBotMove, calcDamage, generateBotStats } from '@/utils/battle'

export type BattlePhase = 'idle' | 'fighting' | 'saving' | 'result'

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

// Convert client-side round log to the DB RoundData shape
function toRoundData(rounds: BattleRoundResult[]): RoundData[] {
  return rounds.map((r) => ({
    round:                    r.round,
    challenger_move:          r.playerMove,
    opponent_move:            r.botMove,
    challenger_damage:        r.playerDmg,
    opponent_damage:          r.botDmg,
    challenger_hp_remaining:  r.playerHp,
    opponent_hp_remaining:    r.botHp,
  }))
}

export function useBattle(player: Player, walletAddress: string) {
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)
  const inventory = usePlayerStore((s) => s.inventory)
  const { data: allItems = [] } = useMarketplaceItems()
  const { checkAchievements, checkDecayRecovery } = useAchievements()

  // Compute equipped weapon (+ATK) and shield (+DEF) boosts from inventory
  const { attackBoost, defenseBoost } = useMemo(() => {
    return inventory.reduce(
      (acc, invItem) => {
        if (!invItem.equipped) return acc
        const item = allItems.find((i) => i.id === invItem.item_id)
        if (!item) return acc
        if (item.category === 'weapon') acc.attackBoost += item.stat_boost
        if (item.category === 'shield') acc.defenseBoost += item.stat_boost
        return acc
      },
      { attackBoost: 0, defenseBoost: 0 },
    )
  }, [inventory, allItems])

  const effectiveAttack = player.attack_stat + attackBoost
  const effectiveDefense = player.defense_stat + defenseBoost

  const [phase, setPhase] = useState<BattlePhase>('idle')
  const [playerHp, setPlayerHp] = useState(100)
  const [botHp, setBotHp] = useState(100)
  const [round, setRound] = useState(1)
  const [log, setLog] = useState<BattleRoundResult[]>([])
  const [specialUsed, setSpecialUsed] = useState(false)
  const [botSpecialUsed, setBotSpecialUsed] = useState(false)
  const [result, setResult] = useState<BattleResultState | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
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
    setSaveError(null)
  }

  const { mutateAsync: finalizeBattle } = useMutation({
    mutationFn: async ({
      won,
      rounds,
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

      // ── Persist battle record ────────────────────────────────────
      const { error: battleError } = await supabase.from('battles').insert({
        challenger_wallet:    walletAddress,
        opponent_wallet:      'bot',
        winner_wallet:        won ? walletAddress : 'bot',
        rounds_data:          toRoundData(rounds),
        xp_awarded_challenger: xp,
        xp_awarded_opponent:  0,
        is_bot:               true,
      })
      if (battleError) throw new Error(`Battle save failed: ${battleError.message}`)

      // ── Update player stats ──────────────────────────────────────
      const playerUpdates: Partial<Player> = {
        xp:           newXp,
        wins,
        losses,
        last_active:  now,
        decay_status: 'none',
      }
      if (newRank) {
        playerUpdates.rank = newRank
        playerUpdates.g_earned_lifetime = player.g_earned_lifetime + gAwarded
      }

      const { error: playerError } = await supabase
        .from('players')
        .update(playerUpdates)
        .eq('wallet_address', walletAddress)
      if (playerError) throw new Error(`Player update failed: ${playerError.message}`)

      updatePlayer(playerUpdates)

      // ── Notify backend of rank-up (fire-and-forget) ───────────────
      if (rankedUp && newRank) {
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/players/${walletAddress}/rank-up`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_rank: newRank }),
        }).catch(console.error)
      }

      // ── Decay recovery: if player was at active decay, award Survivor ─
      if (player.decay_status === 'active') {
        checkDecayRecovery(walletAddress).catch(console.error)
      }

      // ── Achievement check (fire-and-forget — non-blocking) ────────────
      checkAchievements(walletAddress).catch(console.error)

      return { won, xpAwarded: xp, newXp, rankedUp, newRank, gAwarded, rounds }
    },
  })

  async function handleMove(move: BattleMove) {
    if (phase !== 'fighting') return
    if (move === 'special' && specialUsed) return

    const botMove = selectBotMove(botSpecialUsed)
    if (botMove === 'special') setBotSpecialUsed(true)
    if (move === 'special') setSpecialUsed(true)

    const playerDmg = calcDamage(effectiveAttack, botStats.defense, move, botMove)
    const botDmg = calcDamage(botStats.attack, effectiveDefense, botMove, move)

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
      const won = newPlayerHp >= newBotHp
      setPhase('saving') // prevent further moves while DB writes complete
      try {
        const finalResult = await finalizeBattle({
          won,
          rounds: newLog,
          finalPlayerHp: newPlayerHp,
          finalBotHp: newBotHp,
        })
        setResult(finalResult)
        setPhase('result')
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save battle results')
        setPhase('result')
        // Still show result screen with local data even if save failed
        setResult({
          won,
          xpAwarded: won ? XP_WIN : XP_LOSS,
          newXp: Math.min(player.xp + (won ? XP_WIN : XP_LOSS), 999),
          rankedUp: false,
          newRank: null,
          gAwarded: 0,
          rounds: newLog,
        })
      }
    } else {
      setRound((r) => r + 1)
    }
  }

  function reset() {
    setPhase('idle')
    setResult(null)
    setSaveError(null)
  }

  return {
    phase,
    playerHp,
    botHp,
    round,
    log,
    specialUsed,
    result,
    saveError,
    botStats,
    attackBoost,
    defenseBoost,
    effectiveAttack,
    effectiveDefense,
    startBattle,
    handleMove,
    reset,
  }
}
