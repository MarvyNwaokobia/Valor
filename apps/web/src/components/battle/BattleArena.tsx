import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Player, BattleMove } from '@/types'
import {
  simulateBattle,
  generateBotStats,
  selectBotMove,
  calcDamage,
} from '@/utils/battle'
import { XP_WIN, XP_LOSS } from '@/lib/constants'
import { usePlayerStore } from '@/stores/usePlayerStore'
import { supabase } from '@/lib/supabase'
import XpMeter from '@/components/player-card/XpMeter'

interface Props {
  player: Player
  walletAddress: string
}

type Phase = 'select-mode' | 'fighting' | 'result'

interface FightState {
  round: number
  playerHp: number
  botHp: number
  log: string[]
  specialUsed: boolean
}

const MOVES: { id: BattleMove; label: string; desc: string }[] = [
  { id: 'attack', label: '⚔️ Attack', desc: 'Standard strike' },
  { id: 'defend', label: '🛡️ Defend', desc: 'Reduce incoming damage' },
  { id: 'special', label: '💥 Special', desc: 'High damage — once per fight' },
]

export default function BattleArena({ player, walletAddress }: Props) {
  const updatePlayer = usePlayerStore((s) => s.updatePlayer)
  const [phase, setPhase] = useState<Phase>('select-mode')
  const [fight, setFight] = useState<FightState>({
    round: 1,
    playerHp: 100,
    botHp: 100,
    log: [],
    specialUsed: false,
  })
  const [result, setResult] = useState<{ won: boolean; xp: number } | null>(null)
  const [botStats] = useState(() => generateBotStats(player.rank))
  const [botSpecialUsed, setBotSpecialUsed] = useState(false)
  const [pending, setPending] = useState(false)

  function handleMove(move: BattleMove) {
    if (pending) return
    if (move === 'special' && fight.specialUsed) return

    const botMove = selectBotMove(botSpecialUsed)
    if (botMove === 'special') setBotSpecialUsed(true)

    const playerDmg = calcDamage(player.attack_stat, botStats.defense, move, botMove)
    const botDmg = calcDamage(botStats.attack, player.defense_stat, botMove, move)

    const newBotHp = Math.max(0, fight.botHp - playerDmg)
    const newPlayerHp = Math.max(0, fight.playerHp - botDmg)

    const roundLog = `Round ${fight.round}: You ${move} (${playerDmg} dmg) | Bot ${botMove} (${botDmg} dmg)`
    const newLog = [...fight.log, roundLog]

    const isLastRound = fight.round >= 5 || newBotHp <= 0 || newPlayerHp <= 0
    const newSpecialUsed = fight.specialUsed || move === 'special'

    if (isLastRound) {
      const won = newPlayerHp >= newBotHp
      const xp = won ? XP_WIN : XP_LOSS
      setFight({ round: fight.round, playerHp: newPlayerHp, botHp: newBotHp, log: newLog, specialUsed: newSpecialUsed })
      finalizeBattle(won, xp, newLog, newPlayerHp, newBotHp)
    } else {
      setFight({
        round: fight.round + 1,
        playerHp: newPlayerHp,
        botHp: newBotHp,
        log: newLog,
        specialUsed: newSpecialUsed,
      })
    }
  }

  async function finalizeBattle(won: boolean, xp: number, log: string[], playerHp: number, botHp: number) {
    setPending(true)
    setResult({ won, xp })
    setPhase('result')

    const newXp = Math.min(999, player.xp + xp)
    const wins = won ? player.wins + 1 : player.wins
    const losses = !won ? player.losses + 1 : player.losses

    // Persist battle result
    await supabase.from('battles').insert({
      challenger_wallet: walletAddress,
      opponent_wallet: 'bot',
      winner_wallet: won ? walletAddress : 'bot',
      rounds_data: log.map((l, i) => ({ round: i + 1, summary: l })) as never,
      xp_awarded_challenger: xp,
      xp_awarded_opponent: 0,
      is_bot: true,
    })

    await supabase.from('players').update({
      xp: newXp,
      wins,
      losses,
      last_active: new Date().toISOString(),
    }).eq('wallet_address', walletAddress)

    updatePlayer({ xp: newXp, wins, losses })
    setPending(false)
  }

  function resetBattle() {
    setFight({ round: 1, playerHp: 100, botHp: 100, log: [], specialUsed: false })
    setBotSpecialUsed(false)
    setResult(null)
    setPhase('select-mode')
  }

  if (phase === 'select-mode') {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-display font-bold text-white">Battle Arena</h1>
        <button
          onClick={() => setPhase('fighting')}
          className="p-6 bg-valor-surface border-2 border-valor-border rounded-xl hover:border-valor-gold/60 transition-colors text-left"
        >
          <p className="text-xl font-bold text-white">⚔️ Fight a Bot</p>
          <p className="text-slate-400 text-sm mt-1">
            5-round battle against a bot. Win 100 XP, lose 30 XP.
          </p>
        </button>
        <div className="p-6 bg-valor-surface border-2 border-valor-border rounded-xl opacity-50 text-left">
          <p className="text-xl font-bold text-white">🌐 Challenge Player</p>
          <p className="text-slate-400 text-sm mt-1">Coming soon — async multiplayer.</p>
        </div>
      </div>
    )
  }

  if (phase === 'result' && result) {
    return (
      <motion.div
        className="flex flex-col items-center gap-6 py-8"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <p className="text-5xl">{result.won ? '🏆' : '💔'}</p>
        <h2 className="text-3xl font-display font-bold text-white">
          {result.won ? 'Victory!' : 'Defeated'}
        </h2>
        <p className="text-valor-gold font-bold text-xl">+{result.xp} XP</p>
        <XpMeter xp={player.xp} max={1000} rank={player.rank} />
        <div className="flex flex-col gap-2 w-full max-w-sm text-sm text-slate-400 bg-valor-surface rounded-xl p-4">
          {fight.log.map((entry, i) => (
            <p key={i}>{entry}</p>
          ))}
        </div>
        <button
          onClick={resetBattle}
          className="px-8 py-3 bg-valor-gold text-black font-bold rounded-lg hover:bg-valor-gold-light transition-colors"
        >
          Fight Again
        </button>
      </motion.div>
    )
  }

  // Fighting phase
  const playerHpPct = fight.playerHp
  const botHpPct = fight.botHp

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-bold text-white">Round {fight.round} / 5</h2>
      </div>

      {/* HP Bars */}
      <div className="grid grid-cols-2 gap-4">
        <HpBar label={player.character_name} hp={playerHpPct} color="#22c55e" />
        <HpBar label="Bot Opponent" hp={botHpPct} color="#ef4444" />
      </div>

      {/* Move log */}
      <AnimatePresence>
        {fight.log.slice(-1).map((entry, i) => (
          <motion.p
            key={i}
            className="text-xs text-slate-400 text-center"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {entry}
          </motion.p>
        ))}
      </AnimatePresence>

      {/* Move buttons */}
      <div className="grid grid-cols-3 gap-3">
        {MOVES.map(({ id, label, desc }) => {
          const disabled = id === 'special' && fight.specialUsed
          return (
            <button
              key={id}
              onClick={() => handleMove(id)}
              disabled={disabled || pending}
              className={`flex flex-col gap-1 p-4 rounded-xl border text-left transition-all ${
                disabled
                  ? 'border-valor-border opacity-40 cursor-not-allowed'
                  : 'border-valor-border hover:border-valor-gold/60 hover:bg-valor-surface-2 active:scale-95'
              }`}
            >
              <span className="font-bold text-white text-sm">{label}</span>
              <span className="text-xs text-slate-500">{desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function HpBar({ label, hp, color }: { label: string; hp: number; color: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 truncate max-w-[80px]">{label}</span>
        <span className="font-bold text-white">{hp} HP</span>
      </div>
      <div className="h-3 bg-valor-surface-2 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          animate={{ width: `${hp}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}
