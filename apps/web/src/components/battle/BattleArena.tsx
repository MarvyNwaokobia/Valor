import { motion, AnimatePresence } from 'framer-motion'
import type { Player, BattleMove } from '@/types'
import { useBattle } from '@/hooks/useBattle'
import XpMeter from '@/components/player-card/XpMeter'
import { RANK_COLORS, XP_PER_RANK } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'

interface Props {
  player: Player
  walletAddress: string
}

const MOVES: { id: BattleMove; label: string; desc: string; icon: string }[] = [
  { id: 'attack', label: 'Attack', desc: 'Standard strike', icon: '⚔️' },
  { id: 'defend', label: 'Defend', desc: 'Halve incoming damage', icon: '🛡️' },
  { id: 'special', label: 'Special', desc: 'High damage — once only', icon: '💥' },
]

export default function BattleArena({ player, walletAddress }: Props) {
  const {
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
  } = useBattle(player, walletAddress)

  if (phase === 'idle') {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-white">Battle Arena</h1>
          <p className="text-slate-400 text-sm mt-1">
            Win = +100 XP · Loss = +30 XP. Every fight counts.
          </p>
        </div>

        <motion.button
          onClick={startBattle}
          className="p-6 bg-valor-surface border-2 border-valor-border rounded-xl hover:border-valor-gold/60 hover:bg-valor-surface-2 transition-all text-left group"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <div className="flex items-center gap-4">
            <span className="text-4xl">🤖</span>
            <div>
              <p className="font-display font-bold text-white text-lg group-hover:text-valor-gold transition-colors">
                Fight a Bot
              </p>
              <p className="text-slate-400 text-sm mt-0.5">
                5-round battle · Bot scales to your rank
              </p>
            </div>
          </div>
        </motion.button>

        <div className="p-6 bg-valor-surface border-2 border-valor-border/40 rounded-xl opacity-50 text-left">
          <div className="flex items-center gap-4">
            <span className="text-4xl">🌐</span>
            <div>
              <p className="font-display font-bold text-white text-lg">Challenge Player</p>
              <p className="text-slate-400 text-sm mt-0.5">
                Async PvP — coming in next update
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'result' && result) {
    return (
      <motion.div
        className="flex flex-col items-center gap-6 py-4"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
      >
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
        >
          <p className="text-6xl">{result.won ? '🏆' : '💔'}</p>
        </motion.div>

        <div className="text-center">
          <h2 className="text-3xl font-display font-bold text-white">
            {result.won ? 'Victory!' : 'Defeated'}
          </h2>
          <p className="text-valor-gold font-bold text-xl mt-1">+{result.xpAwarded} XP</p>
        </div>

        {/* Rank up celebration */}
        {result.rankedUp && result.newRank && (
          <motion.div
            className="w-full bg-valor-gold/10 border border-valor-gold/40 rounded-xl p-4 text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <p className="text-valor-gold font-display font-bold text-lg">
              ✦ Rank Up! → {result.newRank}
            </p>
            <p className="text-slate-300 text-sm mt-1">
              {formatGDollarNumber(result.gAwarded)} is being sent to your wallet
            </p>
          </motion.div>
        )}

        {/* XP meter */}
        <div className="w-full">
          <XpMeter xp={result.newXp} max={XP_PER_RANK} rank={result.newRank ?? player.rank} />
        </div>

        {/* Round log */}
        <div className="w-full bg-valor-surface rounded-xl border border-valor-border p-4 flex flex-col gap-1.5 max-h-48 overflow-y-auto">
          {result.rounds.map((r) => (
            <div key={r.round} className="flex items-center gap-2 text-xs text-slate-400">
              <span className="text-slate-600 w-14 shrink-0">Round {r.round}</span>
              <span>
                You{' '}
                <span className="text-white font-bold">{r.playerMove}</span>
                {' '}(-{r.botDmg} HP) · Bot{' '}
                <span className="text-white font-bold">{r.botMove}</span>
                {' '}(-{r.playerDmg} HP)
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={reset}
          className="w-full py-3 bg-valor-gold text-black font-bold rounded-xl hover:bg-valor-gold-light transition-colors"
        >
          Fight Again
        </button>
      </motion.div>
    )
  }

  // ── Fighting phase ──
  return (
    <div className="flex flex-col gap-6">
      {/* Round indicator */}
      <div className="flex items-center justify-between">
        <h2 className="font-display font-bold text-white text-lg">
          Round {round} <span className="text-slate-500 font-normal text-base">/ 5</span>
        </h2>
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full ${i < round - 1 ? 'bg-valor-gold' : i === round - 1 ? 'bg-valor-gold/60' : 'bg-valor-border'}`}
            />
          ))}
        </div>
      </div>

      {/* HP bars */}
      <div className="grid grid-cols-2 gap-4">
        <HpBar label={player.character_name} hp={playerHp} color="#22c55e" />
        <HpBar label="Bot Warrior" hp={botHp} color="#ef4444" />
      </div>

      {/* Last round log entry */}
      <AnimatePresence mode="wait">
        {log.length > 0 && (
          <motion.div
            key={log.length}
            className="text-xs text-slate-500 text-center bg-valor-surface-2 rounded-lg px-3 py-2 border border-valor-border"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {(() => {
              const last = log[log.length - 1]
              return (
                <>
                  You <span className="text-white font-bold">{last.playerMove}</span>
                  {' '}dealt {last.playerDmg} · Bot <span className="text-white font-bold">{last.botMove}</span>
                  {' '}dealt {last.botDmg}
                </>
              )
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Move buttons */}
      <div className="grid grid-cols-3 gap-3">
        {MOVES.map(({ id, label, desc, icon }) => {
          const disabled = id === 'special' && specialUsed
          return (
            <motion.button
              key={id}
              onClick={() => handleMove(id)}
              disabled={disabled}
              whileHover={disabled ? {} : { scale: 1.03, y: -2 }}
              whileTap={disabled ? {} : { scale: 0.97 }}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${
                disabled
                  ? 'border-valor-border opacity-30 cursor-not-allowed'
                  : 'border-valor-border hover:border-valor-gold/60 hover:bg-valor-surface-2 cursor-pointer'
              }`}
            >
              <span className="text-2xl">{icon}</span>
              <div>
                <p className="font-bold text-white text-sm">{label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              </div>
              {id === 'special' && specialUsed && (
                <span className="text-xs text-slate-600">Used</span>
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

function HpBar({ label, hp, color }: { label: string; hp: number; color: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 truncate max-w-22.5">{label}</span>
        <span className="font-bold text-white">{hp} HP</span>
      </div>
      <div className="h-3 bg-valor-surface-2 rounded-full overflow-hidden border border-valor-border/50">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          animate={{ width: `${hp}%` }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}
