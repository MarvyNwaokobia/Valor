'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sword, Shield, Zap, Bot, Users, ChevronLeft, Swords } from 'lucide-react'
import type { Player, BattleMove } from '@/types'
import { useBattle } from '@/hooks/useBattle'
import { useValorEngagementRewards } from '@/hooks/useEngagementRewards'
import { useCombatFeel } from '@/hooks/useCombatFeel'
import { useAudio } from '@/hooks/useAudio'
import BattlePvP from './BattlePvP'
import ChallengeBattle from './ChallengeBattle'
import BattleScene from './BattleScene'
import ImpactBurst from './ImpactBurst'
import DamageNumber from './DamageNumber'
import XpMeter from '@/components/player-card/XpMeter'
import CharacterViewer from '@/components/warrior/CharacterViewer'
import { CLASS_DEFINITIONS, CHARACTER_GLB } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'
import { RANK_DEFINITIONS } from '@/lib/ranks'
import RankAura from '@/components/ui/RankAura'
import { XP_PER_RANK } from '@/lib/constants'
import { formatGDollarNumber } from '@/utils/format'

const BOT_CLASS: CharacterClass = 'Berserker'

interface Props { player: Player; walletAddress: string; challengeTarget?: string }

const MOVES: { id: BattleMove; label: string; desc: string; Icon: typeof Sword; color: string }[] = [
  { id: 'attack',  label: 'Attack',  desc: 'Standard strike',       Icon: Sword,  color: '#ef4444' },
  { id: 'defend',  label: 'Defend',  desc: 'Halve incoming damage', Icon: Shield, color: '#3b82f6' },
  { id: 'special', label: 'Special', desc: 'Max power — once only', Icon: Zap,    color: '#8b5cf6' },
]


export default function BattleArena({ player, walletAddress, challengeTarget }: Props) {
  const [showChallenge,       setShowChallenge]       = useState(false)
  const [showDirectChallenge, setShowDirectChallenge] = useState(!!challengeTarget)
  const def    = CLASS_DEFINITIONS[player.character_class as CharacterClass] ?? CLASS_DEFINITIONS.Berserker
  const botDef = CLASS_DEFINITIONS[BOT_CLASS]

  const { phase, playerHp, botHp, round, log, specialUsed, result, saveError, startBattle, handleMove, reset } =
    useBattle(player, walletAddress)

  // ── Animation state ─────────────────────────────────────────────────────
  const [playerAnim,       setPlayerAnim]       = useState('idle')
  const [botAnim,          setBotAnim]          = useState('idle')
  const [isEntering,       setIsEntering]       = useState(false)
  const [showFightCall,    setShowFightCall]    = useState(false)
  const [isRoundAnimating, setIsRoundAnimating] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // ── Damage number events ─────────────────────────────────────────────────
  interface DmgEvent { id: number; value: number; isSpecial: boolean; side: 'player' | 'bot' }
  const [dmgEvents, setDmgEvents] = useState<DmgEvent[]>([])
  const dmgCounter = useRef(0)

  function spawnDmgNumber(value: number, side: 'player' | 'bot', isSpecial: boolean) {
    if (value <= 0) return
    const id = ++dmgCounter.current
    setDmgEvents(prev => [...prev, { id, value, isSpecial, side }])
    setTimeout(() => setDmgEvents(prev => prev.filter(e => e.id !== id)), 700)
  }

  function clearTimers() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  // ── Landscape orientation lock during battle ─────────────────────────────
  useEffect(() => {
    if (phase !== 'fighting') return
    if (typeof screen !== 'undefined' && screen.orientation?.lock) {
      screen.orientation.lock('landscape').catch(() => {})
    }
    return () => {
      try { screen.orientation?.unlock?.() } catch {}
    }
  }, [phase])

  // ── Battle entrance ──────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'fighting' || round !== 1) return
    setIsEntering(true)
    setIsRoundAnimating(true)
    const t1 = setTimeout(() => setShowFightCall(true), 800)
    const t2 = setTimeout(() => { setIsEntering(false); setShowFightCall(false) }, 1450)
    const t3 = setTimeout(() => setIsRoundAnimating(false), 1450)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [phase])

  // ── Audio + combat feel ──────────────────────────────────────────────────
  const { playHit, playSpecial, playVictory, playDefeat, startAmbient, stopAmbient } = useAudio()
  const combatFeel = useCombatFeel()

  // Drive animations + combat feel from round log
  const prevLogLen = useRef(0)
  useEffect(() => {
    if (log.length <= prevLogLen.current) return
    prevLogLen.current = log.length
    const entry = log[log.length - 1]
    clearTimers()

    if (entry.playerHp <= 0) { setPlayerAnim('death'); return }
    if (entry.botHp <= 0)    { setBotAnim('death');    return }

    const playerAction = entry.playerMove === 'attack' || entry.playerMove === 'special' ? 'attack' : 'idle'
    setPlayerAnim(playerAction)

    setIsRoundAnimating(true)

    const t1 = setTimeout(() => {
      setBotAnim(entry.playerDmg > 0 ? 'hit' : 'idle')
      if (entry.playerDmg > 0) {
        combatFeel.triggerHit('bot', entry.playerDmg, def.accentColor, entry.playerMove === 'special')
        spawnDmgNumber(entry.playerDmg, 'bot', entry.playerMove === 'special')
        playHit(player.character_class as string, entry.playerDmg)
        if (entry.playerMove === 'special') playSpecial(player.character_class as string)
      }
    }, 280) // pulled from 320ms — hits when lunge peaks

    const t2 = setTimeout(() => {
      setBotAnim(entry.botMove === 'attack' || entry.botMove === 'special' ? 'attack' : 'idle')
    }, 680)

    const t3 = setTimeout(() => {
      setPlayerAnim(entry.botDmg > 0 ? 'hit' : 'idle')
      if (entry.botDmg > 0) {
        combatFeel.triggerHit('player', entry.botDmg, botDef.accentColor, entry.botMove === 'special')
        spawnDmgNumber(entry.botDmg, 'player', entry.botMove === 'special')
        playHit(BOT_CLASS, entry.botDmg)
        if (entry.botMove === 'special') playSpecial(BOT_CLASS)
      }
    }, 920)

    const t4 = setTimeout(() => {
      setPlayerAnim('idle')
      setBotAnim('idle')
      setIsRoundAnimating(false)
    }, 1400)
    timers.current = [t1, t2, t3, t4]
  }, [log])

  useEffect(() => {
    if (phase === 'fighting') startAmbient()
    if (phase === 'idle' || phase === 'result') stopAmbient()
    if (phase === 'idle') {
      clearTimers()
      prevLogLen.current = 0
      setPlayerAnim('idle')
      setBotAnim('idle')
      setIsEntering(false)
      setShowFightCall(false)
      setIsRoundAnimating(false)
      setDmgEvents([])
      combatFeel.reset()
    }
  }, [phase])

  // ── Reward state ─────────────────────────────────────────────────────────
  const { canClaim, claimEngagementReward, isReady: rewardsReady } = useValorEngagementRewards()
  const [rewardEligible, setRewardEligible] = useState(false)
  const [rewardClaiming, setRewardClaiming] = useState(false)
  const [rewardTxHash,   setRewardTxHash]   = useState<string | null>(null)
  const [rewardError,    setRewardError]    = useState<string | null>(null)

  useEffect(() => {
    if (!result?.won || !rewardsReady) return
    canClaim(walletAddress as `0x${string}`).then(setRewardEligible)
  }, [result?.won, rewardsReady, walletAddress, canClaim])

  // ── Victory / defeat audio — MUST stay above all conditional returns ──────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'result' || !result) return
    if (result.won) playVictory()
    else playDefeat()
  }, [phase, result?.won])

  async function handleClaimReward() {
    setRewardClaiming(true); setRewardError(null)
    try {
      const receipt = await claimEngagementReward(walletAddress as `0x${string}`)
      setRewardTxHash(receipt.transactionHash); setRewardEligible(false)
    } catch (err) {
      setRewardError(err instanceof Error ? err.message : 'Claim failed')
    } finally { setRewardClaiming(false) }
  }

  // ── LIVE PVP ────────────────────────────────────────────────────────────
  if (phase === 'idle' && showChallenge) {
    return <BattlePvP player={player} walletAddress={walletAddress} onBack={() => setShowChallenge(false)} />
  }

  // ── DIRECT CHALLENGE ─────────────────────────────────────────────────────
  if (phase === 'idle' && showDirectChallenge) {
    return <ChallengeBattle walletAddress={walletAddress} onBack={() => setShowDirectChallenge(false)} prefillOpponent={challengeTarget} />
  }

  // ── IDLE — choose fight type ─────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-stretch min-h-[calc(100vh-10rem)] lg:min-h-[calc(100vh-8rem)]">
        <motion.div
          className="relative lg:w-72 rounded-2xl overflow-hidden shrink-0"
          style={{ minHeight: 'clamp(200px, 35vh, 360px)', background: '#06050f' }}
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <RankAura rank={player.rank} classColor={def.accentColor} mode="character">
          <div className="absolute inset-0" style={{
            background: `radial-gradient(ellipse 70% 90% at 50% 60%, ${def.accentColor}18, transparent)`,
          }} />
          <CharacterViewer
            glbPath={CHARACTER_GLB[player.character_class as CharacterClass]}
            accentColor={def.accentColor}
            animationName="idle"
            modelKey={`idle-panel-${player.character_class}`}
            className="absolute inset-0"
          />
          </RankAura>
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
                <p className="font-display font-black text-white text-xl group-hover:text-amber-400 transition-colors">Live PvP</p>
                <p className="text-slate-500 text-sm mt-0.5">Real-time · Fight a live player · Winner takes XP</p>
              </div>
              <ChevronLeft size={16} className="ml-auto rotate-180 text-slate-700 group-hover:text-white transition-colors" />
            </div>
          </motion.button>

          <motion.button onClick={() => setShowDirectChallenge(true)}
            className="group relative overflow-hidden p-6 rounded-2xl border text-left transition-all"
            style={{ background: 'rgba(8,8,14,0.9)', borderColor: 'rgba(42,42,58,0.8)' }}
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'radial-gradient(ellipse 80% 80% at 20% 50%, rgba(234,179,8,0.07), transparent)' }} />
            <div className="absolute inset-y-0 left-0 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: '#eab308' }} />
            <div className="flex items-center gap-5 relative z-10">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                <Swords size={28} style={{ color: '#eab308' }} strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-display font-black text-white text-xl group-hover:text-amber-400 transition-colors">Challenge a Warrior</p>
                <p className="text-slate-500 text-sm mt-0.5">Search by name · Async duel · Share invite link</p>
              </div>
              <ChevronLeft size={16} className="ml-auto rotate-180 text-slate-700 group-hover:text-white transition-colors" />
            </div>
          </motion.button>
        </div>
      </div>
    )
  }

  // ── SAVING ──────────────────────────────────────────────────────────────
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

  // ── RESULT ──────────────────────────────────────────────────────────────

  if (phase === 'result' && result) {
    const resultColor = result.won ? '#eab308' : '#ef4444'
    return (
      <motion.div className="fixed inset-0 z-50 flex flex-col overflow-hidden"
        style={{ background: '#04030c' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
      >
        {/* Background atmosphere */}
        <div className="absolute inset-0 pointer-events-none">
          <div style={{
            background: result.won
              ? `radial-gradient(ellipse 90% 60% at 50% 30%, rgba(234,179,8,0.12), transparent),
                 radial-gradient(ellipse 110% 60% at 50% 110%, rgba(60,10,80,0.6), transparent)`
              : `radial-gradient(ellipse 90% 60% at 50% 30%, rgba(239,68,68,0.08), transparent),
                 radial-gradient(ellipse 110% 60% at 50% 110%, rgba(60,10,80,0.6), transparent)`,
          }} className="absolute inset-0" />
        </div>

        {/* ── Big result announcement ── */}
        <div className="flex-1 flex flex-col items-center justify-center relative z-10 gap-5 px-6">

          {/* Character name + result */}
          <motion.div className="text-center"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.1 }}>
            <p className="font-display font-black uppercase tracking-[0.18em] text-white"
              style={{ fontSize: 'clamp(0.9rem, 3.5vw, 1.2rem)', opacity: 0.6, marginBottom: 4 }}>
              {player.character_name}
            </p>
            <h1 className="font-display font-black leading-none"
              style={{
                fontSize: 'clamp(4rem, 16vw, 7rem)',
                color: resultColor,
                letterSpacing: '0.04em',
                textShadow: `0 0 80px ${resultColor}60, 0 0 160px ${resultColor}30`,
              }}>
              {result.won ? 'WINS!' : 'FALLS'}
            </h1>
            <motion.p className="font-black mt-3" style={{ fontSize: 'clamp(1.3rem, 5vw, 1.8rem)', color: resultColor }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
              +{result.xpAwarded} XP
            </motion.p>
          </motion.div>

          {/* XP progress */}
          <motion.div className="w-full max-w-xs"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
            <XpMeter xp={result.newXp} max={XP_PER_RANK} rank={result.newRank ?? player.rank} />
          </motion.div>

          {/* Rank up banner */}
          {result.rankedUp && result.newRank && (
            <motion.div className="w-full max-w-xs rounded-2xl p-4 text-center"
              style={{
                background: `${RANK_DEFINITIONS[result.newRank]?.badgeBg ?? 'rgba(234,179,8,0.08)'}`,
                border: `1px solid ${RANK_DEFINITIONS[result.newRank]?.color ?? '#eab308'}50`,
                boxShadow: RANK_DEFINITIONS[result.newRank]?.glow,
              }}
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.55, type: 'spring', stiffness: 200, damping: 14 }}>
              <RankAura rank={result.newRank} mode="badge">
                <p className="font-display font-black text-lg"
                  style={{ color: RANK_DEFINITIONS[result.newRank]?.color ?? '#eab308' }}>
                  ✦ RANK UP → {result.newRank}
                </p>
              </RankAura>
              <p className="text-slate-400 text-xs mt-1">{formatGDollarNumber(result.gAwarded)} dispatched to your wallet</p>
            </motion.div>
          )}

          {/* G$ reward claim */}
          {result.won && (rewardEligible || rewardTxHash || rewardError) && (
            <motion.div className="w-full max-w-xs rounded-2xl p-4"
              style={{ background: 'rgba(8,8,14,0.9)', border: '1px solid rgba(42,42,58,0.8)' }}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
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
                    <p className="text-slate-500 text-xs mt-0.5">GoodDollar rewards for verified humans</p>
                  </div>
                  <button onClick={handleClaimReward} disabled={rewardClaiming}
                    className="clip-angled-sm shrink-0 px-4 py-2.5 font-black text-black text-sm disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #fde047, #eab308)' }}>
                    {rewardClaiming ? '...' : 'Claim G$'}
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* Round breakdown (compact, scrollable) */}
          <motion.div className="w-full max-w-xs rounded-xl border overflow-hidden"
            style={{ background: 'rgba(4,3,12,0.9)', borderColor: 'rgba(42,42,58,0.7)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
            <div className="max-h-28 overflow-y-auto px-3 py-2 flex flex-col gap-1">
              {result.rounds.map(r => (
                <div key={r.round} className="flex items-start gap-2 text-[10px]">
                  <span className="text-slate-600 w-10 shrink-0 font-bold">Rd {r.round}</span>
                  <span className="text-slate-400">
                    You <span className="text-white font-bold">{r.playerMove}</span>{' '}
                    <span className="text-red-400">(-{r.botDmg}HP)</span> · Bot{' '}
                    <span className="text-white font-bold">{r.botMove}</span>{' '}
                    <span className="text-red-400">(-{r.playerDmg}HP)</span>
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {saveError && (
            <p className="text-red-400 text-xs text-center">{saveError}</p>
          )}
        </div>

        {/* ── Fight again CTA ── */}
        <div className="relative z-10 px-4"
          style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}>
          <motion.button onClick={reset}
            className="w-full clip-angled py-5 font-display font-black text-black uppercase tracking-[0.2em]"
            style={{
              fontSize: 'clamp(14px, 3.5vw, 18px)',
              background: 'linear-gradient(135deg, #fde047 0%, #eab308 50%, #b45309 100%)',
              boxShadow: '0 0 40px rgba(234,179,8,0.4)',
            }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, type: 'spring', stiffness: 180, damping: 14 }}
            whileTap={{ scale: 0.97 }}>
            Fight Again
          </motion.button>
        </div>
      </motion.div>
    )
  }

  // ── FIGHTING ────────────────────────────────────────────────────────────
  const shakeAnim = combatFeel.shakeLevel > 0
    ? { x: combatFeel.shakeLevel >= 3 ? [-10, 10, -7, 7, -3, 3, 0] : combatFeel.shakeLevel >= 2 ? [-6, 6, -4, 4, 0] : [-3, 3, -2, 2, 0] }
    : { x: 0 }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={{ background: '#04030c' }}>

      {/* ── Portrait rotate overlay — CSS shows it only in portrait ── */}
      <div className="battle-rotate-prompt fixed inset-0 z-200 flex-col items-center justify-center gap-5"
        style={{ background: 'rgba(4,3,12,0.97)' }}>
        <motion.div
          animate={{ rotate: [0, 0, 90, 90, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 1, ease: 'easeInOut' }}
          style={{ fontSize: 56 }}>
          📱
        </motion.div>
        <div className="text-center px-6">
          <p className="font-display font-black text-white text-xl tracking-wide">Rotate Your Device</p>
          <p className="text-slate-400 text-sm mt-2">Battle Arena is designed for landscape</p>
        </div>
      </div>

      {/* ── 3D scene — fills the entire screen, controls overlay on top ── */}
      <motion.div
        key={combatFeel.shakeKey}
        animate={shakeAnim}
        transition={{ duration: combatFeel.shakeLevel >= 3 ? 0.26 : 0.18, ease: 'easeOut' }}
        className="absolute inset-0"
      >
        <motion.div
          key={`cam-${combatFeel.specialCam}`}
          animate={combatFeel.specialCam > 0 ? { scale: [1, 1.055, 1.02, 1] } : {}}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          className="absolute inset-0"
        >
          {/* Canvas */}
          <div className="absolute inset-0">
            <BattleScene
              playerClass={player.character_class as CharacterClass}
              playerAnim={playerAnim}
              playerPaused={combatFeel.hitStopMs > 0 && playerAnim === 'hit'}
              playerAccentColor={def.accentColor}
              botClass={BOT_CLASS}
              botAnim={botAnim}
              botPaused={combatFeel.hitStopMs > 0 && botAnim === 'hit'}
              botAccentColor={botDef.accentColor}
            />
          </div>

          {/* Player DOM overlays — left half */}
          <div className="absolute left-0 top-0 bottom-0 w-1/2 pointer-events-none z-10">
            <AnimatePresence>
              {dmgEvents.filter(e => e.side === 'player').map(e => (
                <DamageNumber key={e.id} {...e} />
              ))}
            </AnimatePresence>
            <AnimatePresence>
              {combatFeel.playerFlash && (
                <motion.div key="player-flash" className="absolute inset-0"
                  style={{ background: `${combatFeel.playerFlash}40` }}
                  initial={{ opacity: 0 }} animate={{ opacity: [0, 0.9, 0] }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }} />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {combatFeel.playerBurst && (
                <ImpactBurst key={`player-burst-${combatFeel.shakeKey}`} color={combatFeel.playerBurst} size="md" />
              )}
            </AnimatePresence>
          </div>

          {/* Bot DOM overlays — right half */}
          <div className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-none z-10">
            <AnimatePresence>
              {dmgEvents.filter(e => e.side === 'bot').map(e => (
                <DamageNumber key={e.id} {...e} />
              ))}
            </AnimatePresence>
            <AnimatePresence>
              {combatFeel.botFlash && (
                <motion.div key="bot-flash" className="absolute inset-0"
                  style={{ background: `${combatFeel.botFlash}40` }}
                  initial={{ opacity: 0 }} animate={{ opacity: [0, 0.9, 0] }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }} />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {combatFeel.botBurst && (
                <ImpactBurst key={`bot-burst-${combatFeel.shakeKey}`} color={combatFeel.botBurst} size="md" />
              )}
            </AnimatePresence>
          </div>

          {/* VS badge */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
            <span className="font-display font-black"
              style={{ fontSize: 'clamp(1.1rem, 4vw, 1.5rem)', color: 'rgba(234,179,8,0.35)', textShadow: '0 0 24px rgba(234,179,8,0.3)' }}>
              VS
            </span>
          </div>

          {/* Battle entrance overlay */}
          <AnimatePresence>
            {isEntering && !showFightCall && (
              <motion.div key="arena-title"
                className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none gap-3"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}>
                <motion.p className="font-display font-bold uppercase"
                  style={{ fontSize: '9px', letterSpacing: '0.5em', color: 'rgba(234,179,8,0.55)' }}
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.35 }}>
                  Valor Arena
                </motion.p>
                <div className="flex items-center gap-4">
                  <motion.span className="font-display font-black"
                    style={{ fontSize: 'clamp(1.1rem, 4.5vw, 1.8rem)', letterSpacing: '0.06em', color: def.accentColor }}
                    initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.25, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
                    {player.character_name}
                  </motion.span>
                  <span className="font-display font-black text-slate-600"
                    style={{ fontSize: 'clamp(1rem, 3.5vw, 1.5rem)' }}>VS</span>
                  <motion.span className="font-display font-black"
                    style={{ fontSize: 'clamp(1.1rem, 4.5vw, 1.8rem)', letterSpacing: '0.06em', color: botDef.accentColor }}
                    initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.25, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
                    Bot Warrior
                  </motion.span>
                </div>
              </motion.div>
            )}
            {showFightCall && (
              <motion.div key="fight-call"
                className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
                initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
                <h2 className="font-display font-black tracking-widest"
                  style={{
                    fontSize: 'clamp(3.5rem, 12vw, 6rem)',
                    color: def.accentColor,
                    textShadow: `0 0 60px ${def.accentColor}, 0 0 100px ${def.accentColor}60`,
                  }}>
                  FIGHT
                </h2>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* ── HUD overlay — floats over the 3D scene at the top ── */}
      <div className="battle-hud absolute inset-x-0 top-0 z-30 flex justify-between items-start px-3"
        style={{
          paddingTop: 'max(14px, env(safe-area-inset-top, 14px))',
          background: 'linear-gradient(180deg, rgba(4,3,12,0.82) 0%, rgba(4,3,12,0.5) 70%, transparent 100%)',
        }}>
        <ArenaPlayerCard name={player.character_name} hp={playerHp}
          classLabel={player.character_class as string} color={def.accentColor} side="left" />

        {/* Round counter */}
        <div className="flex flex-col items-center pt-1 gap-1">
          <motion.span key={round} className="font-display font-black text-white leading-none"
            style={{ fontSize: 'clamp(1.1rem, 4vw, 1.4rem)' }}
            initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
            {round}<span className="text-slate-500 font-normal text-xs ml-0.5">/ 5</span>
          </motion.span>
          <span className="text-[8px] font-bold uppercase tracking-[0.25em] text-slate-600">Round</span>
          <div className="flex gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{
                width: 5, height: 5, borderRadius: '50%',
                background: i < round - 1 ? def.accentColor : i === round - 1 ? `${def.accentColor}70` : 'rgba(42,42,58,0.8)',
                boxShadow: i < round ? `0 0 4px ${def.accentColor}80` : 'none',
                transition: 'all 0.3s ease',
              }} />
            ))}
          </div>
        </div>

        <ArenaPlayerCard name="Bot" hp={botHp}
          classLabel={BOT_CLASS} color={botDef.accentColor} side="right" />
      </div>

      {/* ── Round log — floats just above the buttons ── */}
      <AnimatePresence mode="wait">
        {log.length > 0 && (
          <motion.div key={log.length}
            className="absolute inset-x-3 z-30 text-[10px] text-center rounded-xl px-4 py-2"
            style={{
              bottom: 'calc(max(16px, env(safe-area-inset-bottom, 16px)) + 106px)',
              background: 'rgba(4,3,12,0.85)',
              border: '1px solid rgba(42,42,58,0.7)',
            }}
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
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

      {/* ── Move buttons — overlay at bottom with gradient backdrop ── */}
      <div className="battle-move-buttons absolute inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-2 px-3"
        style={{
          paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
          paddingTop: 8,
          background: 'linear-gradient(0deg, rgba(4,3,12,0.92) 0%, rgba(4,3,12,0.7) 70%, transparent 100%)',
        }}>
        {MOVES.map(({ id, label, desc, Icon, color }) => {
          const disabled = (id === 'special' && specialUsed) || isEntering || isRoundAnimating
          return (
            <motion.button key={id} onClick={() => handleMove(id)} disabled={disabled}
              whileTap={disabled ? {} : { scale: 0.93 }}
              className="relative flex flex-col items-center gap-1.5 py-3 rounded-2xl border overflow-hidden"
              style={{
                background: disabled ? 'rgba(8,8,14,0.5)' : 'rgba(6,5,16,0.92)',
                borderColor: disabled ? 'rgba(42,42,58,0.3)' : `${color}45`,
                opacity: disabled ? 0.35 : 1,
                boxShadow: !disabled && id === 'special' ? `0 0 20px ${color}25, inset 0 0 20px ${color}08` : 'none',
              }}>
              {!disabled && (
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}10, transparent 60%)` }} />
              )}
              <div className="relative z-10 w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: `${color}16`, border: `1px solid ${color}30` }}>
                <Icon size={18} style={{ color: disabled ? '#4a4a5a' : color }} strokeWidth={1.8} />
              </div>
              <span className="relative z-10 font-black text-white text-xs">{label}</span>
              <span className="relative z-10 text-[8px] text-slate-500">{disabled ? 'Used' : desc}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

// ── Arena player card (corner HUD) ───────────────────────────────────────────

function ArenaPlayerCard({ name, hp, classLabel, color, side }: {
  name: string; hp: number; classLabel: string; color: string; side: 'left' | 'right'
}) {
  const hpColor = hp > 60 ? color : hp > 30 ? '#f59e0b' : '#ef4444'
  const isCritical = hp <= 30
  return (
    <div className={`flex flex-col gap-1 ${side === 'right' ? 'items-end' : 'items-start'}`}
      style={{ minWidth: 110, maxWidth: 150 }}>
      <div className={`flex items-center gap-1.5 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
        <div className="w-7 h-7 rounded-full border flex items-center justify-center shrink-0 font-black text-xs"
          style={{ borderColor: `${color}60`, background: `${color}18`, color }}>
          ⚔
        </div>
        <div className={side === 'right' ? 'text-right' : ''}>
          <p className="font-black text-white leading-none" style={{ fontSize: 10 }}>{name}</p>
          <p className="font-bold uppercase" style={{ fontSize: 7, letterSpacing: '0.18em', color }}>{classLabel}</p>
        </div>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden w-full"
        style={{ background: 'rgba(42,42,58,0.7)' }}>
        <motion.div className="h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${hpColor}90, ${hpColor})`,
            boxShadow: isCritical ? `0 0 6px ${hpColor}` : 'none',
          }}
          animate={{ width: `${hp}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
      <span className="font-black" style={{ fontSize: 9, color: hpColor }}>
        {hp}<span className="text-slate-500 font-normal" style={{ fontSize: 8 }}>HP</span>
        {isCritical && <span className="text-red-400 font-black ml-1 animate-pulse" style={{ fontSize: 7 }}>CRIT</span>}
      </span>
    </div>
  )
}
