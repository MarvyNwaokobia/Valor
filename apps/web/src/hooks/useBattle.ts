import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { useAchievements } from '@/hooks/useAchievements'
import type { Player, BattleMove, Item } from '@/types'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export type BattlePhase = 'idle' | 'fighting' | 'saving' | 'result'

export interface BattleRoundResult {
  round:      number
  playerMove: BattleMove
  botMove:    BattleMove
  playerDmg:  number
  botDmg:     number
  playerHp:   number
  botHp:      number
}

export interface BattleResultState {
  won:        boolean
  xpAwarded:  number
  newXp:      number
  rankedUp:   boolean
  newRank:    Player['rank'] | null
  gAwarded:   number
  rounds:     BattleRoundResult[]
}

// Client-side damage preview for live HP bar animation during play.
// The server re-runs the full simulation with its own bot moves — this is cosmetic only.
function previewDamage(
  attack: number,
  defense: number,
  isSpecial: boolean,
  opponentDefending: boolean,
): number {
  const base     = isSpecial ? 40 : 20
  const variance = base * 0.2 * (Math.random() * 2 - 1)
  const statMod  = 1 + (attack - defense) * 0.01
  const defMult  = opponentDefending ? 0.5 : 1
  return Math.max(1, Math.round((base + variance) * statMod * defMult))
}

function generateBotPreviewStats(playerRank: Player['rank']): { attack: number; defense: number } {
  const base: Record<Player['rank'], number> = {
    Bronze: 10, Silver: 15, Gold: 20, Platinum: 25, Diamond: 30,
  }
  const variance = Math.floor(Math.random() * 5) - 2
  return { attack: base[playerRank] + variance, defense: base[playerRank] + variance }
}

export function useBattle(player: Player, walletAddress: string) {
  const updatePlayer              = usePlayerStore((s) => s.updatePlayer)
  const { checkAchievements, checkDecayRecovery } = useAchievements()
  const inventory = usePlayerStore((s) => s.inventory)
  const itemIds   = inventory.map(i => i.item_id)

  const { data: items = [] } = useQuery({
    queryKey: ['items', itemIds],
    queryFn: async () => {
      if (itemIds.length === 0) return []
      const res = await fetch(`${API}/items`)
      if (!res.ok) return []
      const all: Item[] = await res.json()
      return all.filter(i => itemIds.includes(i.id))
    },
    enabled: itemIds.length > 0,
    staleTime: 60_000,
  })

  const itemMap      = new Map(items.map(i => [i.id, i]))
  const equipped     = inventory.filter(i => i.equipped).map(i => itemMap.get(i.item_id)).filter(Boolean) as Item[]
  const attackBoost  = equipped.filter(i => i.category === 'weapon').reduce((s, i) => s + i.stat_boost, 0)
  const defenseBoost = equipped.filter(i => i.category === 'shield').reduce((s, i) => s + i.stat_boost, 0)
  const hasXpBooster = equipped.some(i => i.category === 'booster')
  const effectiveAttack  = player.attack_stat  + attackBoost
  const effectiveDefense = player.defense_stat + defenseBoost

  const [phase,         setPhase]         = useState<BattlePhase>('idle')
  const [playerHp,      setPlayerHp]      = useState(100)
  const [botHp,         setBotHp]         = useState(100)
  const [round,         setRound]         = useState(1)
  const [log,           setLog]           = useState<BattleRoundResult[]>([])
  const [specialUsed,   setSpecialUsed]   = useState(false)
  const [result,        setResult]        = useState<BattleResultState | null>(null)
  const [saveError,     setSaveError]     = useState<string | null>(null)
  const [allMoves,      setAllMoves]      = useState<BattleMove[]>([])
  const [botStats]                        = useState(() => generateBotPreviewStats(player.rank))

  function startBattle() {
    setPhase('fighting')
    setPlayerHp(100)
    setBotHp(100)
    setRound(1)
    setLog([])
    setSpecialUsed(false)
    setResult(null)
    setSaveError(null)
    setAllMoves([])
  }

  async function handleMove(move: BattleMove) {
    if (phase !== 'fighting') return
    if (move === 'special' && specialUsed) return

    if (move === 'special') setSpecialUsed(true)

    // ── Client-side preview for live HP animation ────────────────────
    // Bot move is a local preview — the real bot moves are generated server-side.
    const botPreviewMove: BattleMove =
      Math.random() < 0.5 ? 'attack' : Math.random() < 0.5 ? 'defend' : 'special'

    const playerDmg = previewDamage(effectiveAttack,  botStats.defense,  move === 'special',          botPreviewMove === 'defend')
    const botDmg    = previewDamage(botStats.attack,  effectiveDefense,  botPreviewMove === 'special', move === 'defend')

    const newBotHp    = Math.max(0, botHp    - playerDmg)
    const newPlayerHp = Math.max(0, playerHp - botDmg)

    const roundEntry: BattleRoundResult = {
      round, playerMove: move, botMove: botPreviewMove,
      playerDmg, botDmg, playerHp: newPlayerHp, botHp: newBotHp,
    }

    const newLog   = [...log, roundEntry]
    const newMoves = [...allMoves, move]

    setLog(newLog)
    setAllMoves(newMoves)
    setPlayerHp(newPlayerHp)
    setBotHp(newBotHp)

    const isLastRound = round >= 5 || newBotHp <= 0 || newPlayerHp <= 0

    if (isLastRound) {
      setPhase('saving')
      try {
        // ── Server resolves the battle authoritatively ───────────────
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/battles/bot`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ wallet: walletAddress, player_moves: newMoves }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error ?? `API error ${res.status}`)
        }

        const data = await res.json()

        // Map snake_case API response → camelCase BattleResultState
        const finalResult: BattleResultState = {
          won:       data.won,
          xpAwarded: data.xp_awarded,
          newXp:     data.new_xp,
          rankedUp:  data.ranked_up,
          newRank:   data.new_rank ?? null,
          gAwarded:  data.g_awarded,
          // Use server's authoritative round data, falling back to client preview log
          rounds: (data.rounds as Array<{
            round: number; player_move: string; bot_move: string
            player_dmg: number; bot_dmg: number; player_hp: number; bot_hp: number
          }>)?.map((r) => ({
            round:      r.round,
            playerMove: r.player_move as BattleMove,
            botMove:    r.bot_move    as BattleMove,
            playerDmg:  r.player_dmg,
            botDmg:     r.bot_dmg,
            playerHp:   r.player_hp,
            botHp:      r.bot_hp,
          })) ?? newLog,
        }

        // ── Sync player store from server response ───────────────────
        const storeUpdates: Partial<Player> = {
          xp:           data.new_xp,
          wins:         data.won ? player.wins + 1 : player.wins,
          losses:       data.won ? player.losses : player.losses + 1,
          decay_status: 'none',
        }
        if (data.ranked_up && data.new_rank) {
          storeUpdates.rank             = data.new_rank
          storeUpdates.g_earned_lifetime = player.g_earned_lifetime + data.g_awarded
        }
        updatePlayer(storeUpdates)

        // ── Fire-and-forget side effects ─────────────────────────────
        if (player.decay_status === 'active') {
          checkDecayRecovery(walletAddress).catch(console.error)
        }
        checkAchievements(walletAddress).catch(console.error)

        setResult(finalResult)
        setPhase('result')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save battle'
        setSaveError(msg)
        // Show a local result so the player isn't left on a blank screen
        setResult({
          won:      newPlayerHp >= newBotHp,
          xpAwarded: 0,
          newXp:    player.xp,
          rankedUp: false,
          newRank:  null,
          gAwarded: 0,
          rounds:   newLog,
        })
        setPhase('result')
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
    hasXpBooster,
    effectiveAttack,
    effectiveDefense,
    startBattle,
    handleMove,
    reset,
  }
}
