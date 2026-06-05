'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sword, Shield, Zap, Bot, Trophy, HeartCrack, Users, ChevronLeft } from 'lucide-react'
import type { Player, BattleMove } from '@/types'
import { useBattle } from '@/hooks/useBattle'
import { useValorEngagementRewards } from '@/hooks/useEngagementRewards'
import ChallengeBattle from './ChallengeBattle'
import XpMeter from '@/components/player-card/XpMeter'
import CharacterViewer from '@/components/warrior/CharacterViewer'
import { CLASS_DEFINITIONS, CHARACTER_GLB, CHARACTER_IMAGES } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'
import { XP_PER_RANK } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'

// Bot always shows as Berserker — the default arena enemy
const BOT_CLASS: CharacterClass = 'Berserker'

interface Props { player: Player; walletAddress: string }

const MOVES: { id: BattleMove; label: string; desc: string; Icon: typeof Sword; color: string }[] = [
  { id: 'attack',  label: 'Attack',  desc: 'Standard strike',       Icon: Sword,  color: '#ef4444' },
  { id: 'defend',  label: 'Defend',  desc: 'Halve incoming damage', Icon: Shield, color: '#3b82f6' },
  { id: 'special', label: 'Special', desc: 'Max power — once only', Icon: Zap,    color: '#8b5cf6' },
]

export default function BattleArena({ player, walletAddress }: Props) {
  const [showChallenge, setShowChallenge] = useState(false)
  const def    = CLASS_DEFINITIONS[player.character_class as CharacterClass] ?? CLASS_DEFINITIONS.Berserker
  const botDef = CLASS_DEFINITIONS[BOT_CLASS]

  const { phase, playerHp, botHp, round, log, specialUsed, result, saveError, startBattle, handleMove, reset } =
    useBattle(player, walletAddress)

  // ── Animation state ────────────────────────────────────────────────
  const [playerAnim, setPlayerAnim] = useState('idle')
  const [botAnim,    setBotAnim]    = useState('idle')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  function clearTimers() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  // Drive character animations from round log entries
  const prevLogLen = useRef(0)
  useEffect(() => {
    if (log.length <= prevLogLen.current) return
    prevLogLen.current = log.length
    const entry = log[log.length - 1]
    clearTimers()

    if (entry.playerHp <= 0) {
      setPlayerAnim('death')
      return
    }
    if (entry.botHp <= 0) {
      setBotAnim('death')
      return
    }

    // Sequence: player acts → bot reacts → bot counters → player reacts → idle
    const playerAction = entry.playerMove === 'attack' || entry.playerMove === 'special' ? 'attack' : 'idle'
    setPlayerAnim(playerAction)

    const t1 = setTimeout(() => setBotAnim(entry.playerDmg > 0 ? 'hit' : 'idle'), 320)
    const t2 = setTimeout(() => setBotAnim(entry.botMove === 'attack' || entry.botMove === 'special' ? 'attack' : 'idle'), 740)
    const t3 = setTimeout(() => setPlayerAnim(entry.botDmg > 0 ? 'hit' : 'idle'), 980)
    const t4 = setTimeout(() => { setPlayerAnim('idle'); setBotAnim('idle') }, 1500)
    timers.current = [t1, t2, t3, t4]
  }, [log])

  // Reset animation state when battle resets
  useEffect(() => {
    if (phase === 'idle') {
      clearTimers()
      prevLogLen.current = 0
      setPlayerAnim('idle')
      setBotAnim('idle')
    }
  }, [phase])

  // ── Reward state ───────────────────────────────────────────────────
  const { canClaim, claimEngagementReward, isReady: rewardsReady } = useValorEngagementRewards()
  const [rewardEligible, setRewardEligible] = useState(false)
  const [rewardClaiming, setRewardClaiming] = useState(false)
  const [rewardTxHash,   setRewardTxHash]   = useState<string | null>(null)
  const [rewardError,    setRewardError]    = useState<string | null>(null)

  useEffect(() => {
    if (!result?.won || !rewardsReady) return
    canClaim(walletAddress as `0x${string}`).then(setRewardEligible)
  }, [result?.won, rewardsReady, walletAddress, canClaim])

  async function handleClaimReward() {
    setRewardClaiming(true); setRewardError(null)
    try {
      const receipt = await claimEngagementReward(walletAddress as `0x${string}`)
      setRewardTxHash(receipt.transactionHash); setRewardEligible(false)
    } catch (err) {
      setRewardError(err instanceof Error ? err.message : 'Claim failed')
    } finally { setRewardClaiming(false) }
  }

  // ── CHALLENGE BATTLE ──────────────────────────────────────────────
  if (phase === 'idle' && showChallenge) {
    return <ChallengeBattle walletAddress={walletAddress} onBack={() => setShowChallenge(false)} />
  }

  // ── IDLE — choose fight type ───────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="flex flex-col lg:flex-row gap-6 items-stretch min-h-[calc(100vh-8rem)]">

        {/* 3D character panel */}
        <motion.div
          className="relative lg:w-72 rounded-2xl overflow-hidden shrink-0"
          style={{ minHeight: 360, background: '#06050f' }}
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="absolute inset-0" style={{
            background: `radial-gradient(ellipse 70% 90% at 50% 60%, ${def.accentColor}18, transparent)`,
          }} />
          <CharacterViewer
            glbPath={CHARACTER_GLB[player.character_class as CharacterClass]}
            accentColor={def.accentColor}
            animationName="idle"
            modelKey={`idle-panel-${player.character_class}`}
            className="absolute inset-0"
            fallback={
              <img
                src={CHARACTER_IMAGES[player.character_class as CharacterClass]?.male}
                alt="" aria-hidden
                className="absolute inset-0 w-full h-full object-cover object-top select-none"
                style={{ filter: `contrast(1.05) drop-shadow(0 0 24px ${def.glowColor})` }}
              />
            }
          />
          <div className="absolute inset-x-0 bottom-0 h-28" style={{
            background: 'linear-gradient(0deg, rgba(4,3,12,0.98) 0%, transparent 100%)',
          }} />
          <div className="absolute inset-x-0 bottom-0 p-4 z-10">
            <p className="font-display font-black text-white text-lg">{player.character_name}</p>
            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-sm"
              style={{ background: def.accentColorDim, color: def.accentColor }}>
              {player.character_class}
            </span>
          </div>
        </motion.div>

        {/* Right: choose battle mode */}
        <div className="flex-1 flex flex-col gap-4 justify-center">
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <p className="text-[10px] uppercase tracking-[0.3em] font-bold mb-1" style={{ color: def.accentColor }}>
              Battle Arena
            </p>
            <h1 className="font-display font-black text-white text-3xl tracking-wide">Choose Your Fight</h1>
            <p className="text-slate-500 text-sm mt-1">Win = +100 XP · Loss = +30 XP · Every fight counts.</p>
          </motion.div>

          <motion.button onClick={startBattle}
            className="group relative overflow-hidden p-6 rounded-2xl border text-left transition-all"
            style={{ background: 'rgba(8,8,14,0.9)', borderColor: 'rgba(42,42,58,0.8)' }}
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'radial-gradient(ellipse 80% 80% at 20% 50%, rgba(239,68,68,0.08), transparent)' }} />
            <div className="absolute inset-y-0 left-0 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: '#ef4444' }} />
            <div className="flex items-center gap-5 relative z-10">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <Bot size={28} style={{ color: '#ef4444' }} strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-display font-black text-white text-xl group-hover:text-amber-400 transition-colors">Fight a Bot</p>
                <p className="text-slate-500 text-sm mt-0.5">5-round battle · Scales to your rank · Instant result</p>
              </div>
              <ChevronLeft size={16} className="ml-auto rotate-180 text-slate-700 group-hover:text-white transition-colors" />
            </div>
          </motion.button>

          <motion.button onClick={() => setShowChallenge(true)}
            className="group relative overflow-hidden p-6 rounded-2xl border text-left transition-all"
            style={{ background: 'rgba(8,8,14,0.9)', borderColor: 'rgba(42,42,58,0.8)' }}
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'radial-gradient(ellipse 80% 80% at 20% 50%, rgba(59,130,246,0.08), transparent)' }} />
            <div className="absolute inset-y-0 left-0 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: '#3b82f6' }} />
            <div className="flex items-center gap-5 relative z-10">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}>
                <Users size={28} style={{ color: '#3b82f6' }} strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-display font-black text-white text-xl group-hover:text-amber-400 transition-colors">Challenge Player</p>
                <p className="text-slate-500 text-sm mt-0.5">Async PvP · Both earn XP · Instant result</p>
              </div>
              <ChevronLeft size={16} className="ml-auto rotate-180 text-slate-700 group-hover:text-white transition-colors" />
            </div>
          </motion.button>
        </div>
      </div>
    )
  }

  // ── SAVING ────────────────────────────────────────────────────────
  if (phase === 'saving') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <motion.div
          className="w-12 h-12 rounded-full border-2 border-t-transparent"
          style={{ borderColor: `${def.accentColor} transparent transparent transparent` }}
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        />
        <p className="text-slate-400 text-sm uppercase tracking-widest">Recording battle...</p>
      </div>
    )
  }

  // ── RESULT ────────────────────────────────────────────────────────
  if (phase === 'result' && result) {
    return (
      <motion.div className="flex flex-col items-center gap-6 py-6"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
      >
        <motion.div
          className="w-full relative overflow-hidden rounded-2xl p-8 flex flex-col items-center gap-3"
          style={{
            background: result.won
              ? 'linear-gradient(135deg, rgba(234,179,8,0.15) 0%, rgba(4,3,12,0.95) 70%)'
              : 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(4,3,12,0.95) 70%)',
            border: `1px solid ${result.won ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.25)'}`,
          }}
          initial={{ scale: 0.9 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 14 }}
        >
          <motion.div initial={{ scale: 0, rotate: -15 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 180, damping: 12, delay: 0.1 }}>
            {result.won
              ? <Trophy size={64} className="text-amber-400" strokeWidth={1.2} />
              : <HeartCrack size={64} className="text-red-500" strokeWidth={1.2} />}
          </motion.div>
          <h2 className="font-display font-black text-white text-4xl tracking-wider">
            {result.won ? 'VICTORY' : 'DEFEATED'}
          </h2>
          <p className="font-black text-2xl" style={{ color: result.won ? '#eab308' : '#ef4444' }}>
            +{result.xpAwarded} XP
          </p>
        </motion.div>

        {result.rankedUp && result.newRank && (
          <motion.div className="w-full rounded-2xl p-5 text-center"
            style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.35)' }}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          >
            <p className="font-display font-black text-amber-400 text-xl">✦ RANK UP → {result.newRank}</p>
            <p className="text-slate-300 text-sm mt-1">{formatGDollarNumber(result.gAwarded)} dispatched to your wallet</p>
          </motion.div>
        )}

        {result.won && (rewardEligible || rewardTxHash || rewardError) && (
          <motion.div className="w-full rounded-2xl p-4"
            style={{ background: 'rgba(18,18,26,0.9)', border: '1px solid rgba(42,42,58,0.8)' }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          >
            {rewardTxHash ? (
              <div className="text-center">
                <p className="text-green-400 font-black text-sm">G$ Reward Claimed!</p>
                <a href={`https://celoscan.io/tx/${rewardTxHash}`} target="_blank" rel="noreferrer"
                  className="text-xs text-slate-500 underline mt-1 block">View on Celoscan</a>
              </div>
            ) : rewardError ? (
              <p className="text-red-400 text-xs text-center">{rewardError}</p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-white font-black text-sm">Claim G$ Reward</p>
                  <p className="text-slate-500 text-xs mt-0.5">GoodDollar rewards for verified humans who play</p>
                </div>
                <button onClick={handleClaimReward} disabled={rewardClaiming}
                  className="clip-angled-sm shrink-0 px-5 py-2.5 font-black text-black text-sm disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #fde047, #eab308)' }}>
                  {rewardClaiming ? 'Signing...' : 'Claim G$'}
                </button>
              </div>
            )}
          </motion.div>
        )}

        <div className="w-full">
          <XpMeter xp={result.newXp} max={XP_PER_RANK} rank={result.newRank ?? player.rank} />
        </div>

        <div className="w-full rounded-xl border p-4 flex flex-col gap-1.5 max-h-44 overflow-y-auto"
          style={{ background: 'rgba(8,8,14,0.9)', borderColor: 'rgba(42,42,58,0.8)' }}>
          {result.rounds.map(r => (
            <div key={r.round} className="flex items-start gap-2 text-xs">
              <span className="text-slate-600 w-14 shrink-0 font-bold">Round {r.round}</span>
              <span className="text-slate-400">
                You <span className="text-white font-bold">{r.playerMove}</span>{' '}
                <span className="text-red-400">(-{r.botDmg}HP)</span> · Bot{' '}
                <span className="text-white font-bold">{r.botMove}</span>{' '}
                <span className="text-red-400">(-{r.playerDmg}HP)</span>
              </span>
            </div>
          ))}
        </div>

        {saveError && (
          <div className="w-full rounded-xl p-3"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <p className="text-red-400 text-xs text-center">{saveError}</p>
          </div>
        )}

        <button onClick={reset}
          className="w-full clip-angled py-4 font-display font-black text-black uppercase tracking-[0.18em] text-sm"
          style={{ background: 'linear-gradient(135deg, #fde047 0%, #eab308 50%, #b45309 100%)', boxShadow: '0 0 28px rgba(234,179,8,0.35)' }}>
          Fight Again
        </button>
      </motion.div>
    )
  }

  // ── FIGHTING ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 max-w-lg mx-auto">

      {/* ── Arena scene — two 3D characters facing each other ── */}
      <div className="relative w-full rounded-2xl overflow-hidden" style={{ height: 260, background: '#04030c' }}>

        {/* Ground atmosphere */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 70% 50% at 50% 100%, rgba(60,20,100,0.35), transparent)',
        }} />

        {/* Player — left half */}
        <div className="absolute left-0 top-0 w-1/2 h-full">
          <CharacterViewer
            glbPath={CHARACTER_GLB[player.character_class as CharacterClass]}
            accentColor={def.accentColor}
            animationName={playerAnim}
            modelKey={`fight-player-${player.character_class}`}
            className="absolute inset-0"
            fallback={
              <div className="absolute inset-0 flex items-end justify-center pb-2">
                <img
                  src={CHARACTER_IMAGES[player.character_class as CharacterClass]?.male}
                  alt="" aria-hidden
                  className="h-full w-auto object-contain object-bottom select-none"
                  style={{ filter: `drop-shadow(0 0 20px ${def.glowColor})` }}
                />
              </div>
            }
          />
          {/* Player name tag */}
          <div className="absolute bottom-2 left-0 right-0 flex justify-center z-10 pointer-events-none">
            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
              style={{ background: `${def.accentColor}22`, color: def.accentColor, border: `1px solid ${def.accentColor}33` }}>
              {player.character_name}
            </span>
          </div>
        </div>

        {/* Bot — right half, mirrored so it faces left (toward the player) */}
        <div className="absolute right-0 top-0 w-1/2 h-full" style={{ transform: 'scaleX(-1)' }}>
          <CharacterViewer
            glbPath={CHARACTER_GLB[BOT_CLASS]}
            accentColor={botDef.accentColor}
            animationName={botAnim}
            modelKey="fight-bot-berserker"
            className="absolute inset-0"
            fallback={
              <div className="absolute inset-0 flex items-end justify-center pb-2">
                <img
                  src={CHARACTER_IMAGES[BOT_CLASS]?.male}
                  alt="" aria-hidden
                  className="h-full w-auto object-contain object-bottom select-none"
                  style={{ filter: `drop-shadow(0 0 20px ${botDef.glowColor})` }}
                />
              </div>
            }
          />
        </div>
        {/* Bot name tag (not mirrored — placed outside the scaleX container) */}
        <div className="absolute bottom-2 right-0 w-1/2 flex justify-center z-10 pointer-events-none">
          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded"
            style={{ background: `${botDef.accentColor}22`, color: botDef.accentColor, border: `1px solid ${botDef.accentColor}33` }}>
            Bot Warrior
          </span>
        </div>

        {/* VS badge */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
          <span className="font-display font-black text-xl"
            style={{ color: 'rgba(234,179,8,0.45)', textShadow: '0 0 20px rgba(234,179,8,0.3)' }}>
            VS
          </span>
        </div>

        {/* HP bars — overlaid at top of the scene */}
        <div className="absolute inset-x-0 top-0 z-10 px-3 pt-2.5 grid grid-cols-2 gap-3">
          <ArenaHpBar label={player.character_name} hp={playerHp} color={def.accentColor} side="player" />
          <ArenaHpBar label="Bot" hp={botHp} color={botDef.accentColor} side="bot" />
        </div>
      </div>

      {/* ── Round tracker ── */}
      <div className="flex items-center justify-between px-1">
        <h2 className="font-display font-black text-white text-lg">
          Round {round} <span className="text-slate-600 font-normal text-sm">/ 5</span>
        </h2>
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-2.5 h-2.5 rounded-full transition-all" style={{
              background: i < round - 1 ? def.accentColor : i === round - 1 ? `${def.accentColor}66` : 'rgba(42,42,58,0.8)',
              boxShadow: i < round ? `0 0 6px ${def.accentColor}80` : 'none',
            }} />
          ))}
        </div>
      </div>

      {/* ── Last round log ── */}
      <AnimatePresence mode="wait">
        {log.length > 0 && (
          <motion.div key={log.length}
            className="text-xs text-center rounded-lg px-4 py-2.5 border"
            style={{ background: 'rgba(8,8,14,0.9)', borderColor: 'rgba(42,42,58,0.8)' }}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          >
            {(() => {
              const last = log[log.length - 1]
              return (
                <span className="text-slate-400">
                  You <span className="text-white font-bold">{last.playerMove}</span>{' '}
                  <span className="text-green-400 font-bold">dealt {last.playerDmg}</span>{' · '}
                  Bot <span className="text-white font-bold">{last.botMove}</span>{' '}
                  <span className="text-red-400 font-bold">dealt {last.botDmg}</span>
                </span>
              )
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Move buttons ── */}
      <div className="grid grid-cols-3 gap-3">
        {MOVES.map(({ id, label, desc, Icon, color }) => {
          const disabled = id === 'special' && specialUsed
          return (
            <motion.button key={id} onClick={() => handleMove(id)} disabled={disabled}
              whileHover={disabled ? {} : { scale: 1.03, y: -2 }}
              whileTap={disabled ? {} : { scale: 0.97 }}
              className="relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all overflow-hidden"
              style={{
                background: disabled ? 'rgba(8,8,14,0.5)' : 'rgba(8,8,14,0.9)',
                borderColor: disabled ? 'rgba(42,42,58,0.4)' : `${color}30`,
                opacity: disabled ? 0.35 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {!disabled && (
                <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity"
                  style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}12, transparent 65%)` }} />
              )}
              <div className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
                <Icon size={20} style={{ color: disabled ? '#4a4a5a' : color }} strokeWidth={1.8} />
              </div>
              <div className="relative z-10 text-center">
                <p className="font-black text-white text-sm">{label}</p>
                <p className="text-[9px] text-slate-500 mt-0.5">{disabled ? 'Used' : desc}</p>
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

// ── HP bar ────────────────────────────────────────────────────────────────────

function ArenaHpBar({ label, hp, color, side }: { label: string; hp: number; color: string; side: 'player' | 'bot' }) {
  return (
    <div className={`flex flex-col gap-1 ${side === 'bot' ? 'items-end text-right' : ''}`}>
      <div className="flex items-center justify-between w-full gap-1 text-[10px]">
        {side === 'player'
          ? <><span className="text-slate-400 font-bold truncate">{label}</span><span className="font-black text-white shrink-0">{hp}<span className="text-slate-500 font-normal">HP</span></span></>
          : <><span className="font-black text-white shrink-0">{hp}<span className="text-slate-500 font-normal">HP</span></span><span className="text-slate-400 font-bold truncate">{label}</span></>
        }
      </div>
      <div className="h-2 w-full rounded-full overflow-hidden"
        style={{ background: 'rgba(18,18,26,0.8)', border: '1px solid rgba(42,42,58,0.5)' }}>
        <motion.div className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}99, ${color})`, boxShadow: `0 0 4px ${color}60` }}
          animate={{ width: `${hp}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}
