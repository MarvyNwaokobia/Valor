'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sword, Shield, Zap, Trophy, HeartCrack, Wifi, WifiOff } from 'lucide-react'
import { useGameSocket, type ActionType } from '@/hooks/useGameSocket'
import { CLASS_DEFINITIONS } from '@/lib/classes'
import type { CharacterClass } from '@/lib/classes'
import type { Player } from '@/types'
import { useCombatFeel } from '@/hooks/useCombatFeel'
import { useAudio } from '@/hooks/useAudio'
import WeaponTrail from './WeaponTrail'
import CombatOverlay from './CombatOverlay'
import ComboCounter from './ComboCounter'
import DamageNumber from './DamageNumber'
import ImpactBurst from './ImpactBurst'
import HitSpark from './HitSpark'
import IllustratedBattleScene from './IllustratedBattleScene'

interface Props {
  player:        Player
  walletAddress: string
  onBack:        () => void
}

// Cooldown durations match server-side enforcement (ms)
const COOLDOWNS: Record<ActionType, number> = {
  attack:  1500,
  block:   2000,
  special: 8000,
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BattlePvP({ player, walletAddress, onBack }: Props) {
  const { state, connect, sendAction, disconnect } = useGameSocket(player, walletAddress)
  const def    = CLASS_DEFINITIONS[player.character_class as CharacterClass] ?? CLASS_DEFINITIONS.Berserker
  const oppDef = state.opponent
    ? (CLASS_DEFINITIONS[state.opponent.class as CharacterClass] ?? CLASS_DEFINITIONS.Berserker)
    : CLASS_DEFINITIONS.Berserker

  // ── Phase: IDLE / ENTRY ───────────────────────────────────────────────────

  if (state.phase === 'idle') {
    return (
      <div className="fixed inset-0 z-60 flex flex-col items-center justify-center" style={{ background: '#04030c' }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `radial-gradient(ellipse 70% 50% at 50% 60%, ${def.accentColor}15, transparent)`,
        }} />
        <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center">
          <div>
            <p className="font-display font-bold uppercase text-slate-500" style={{ fontSize: '9px', letterSpacing: '0.4em' }}>
              VALOR · LIVE PVP
            </p>
            <h1 className="font-display font-black text-white mt-1" style={{ fontSize: 'clamp(2rem,7vw,3.5rem)', letterSpacing: '0.08em' }}>
              BATTLE ARENA
            </h1>
          </div>
          <motion.button
            onClick={connect}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            className="relative overflow-hidden font-display font-black uppercase px-12"
            style={{
              fontSize: '13px', letterSpacing: '0.24em', color: '#080610',
              padding: '18px 48px',
              background: `linear-gradient(135deg, ${def.accentColor}ee, ${def.accentColor})`,
              clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)',
              boxShadow: `0 0 36px ${def.accentColor}55`,
            }}
          >
            Find Opponent
          </motion.button>
          <button onClick={onBack} className="text-slate-600 text-xs hover:text-slate-400 transition-colors font-bold uppercase tracking-widest">
            ← Back
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: QUEUING ────────────────────────────────────────────────────────

  if (state.phase === 'queuing') {
    return (
      <div className="fixed inset-0 z-60 flex flex-col items-center justify-center gap-8" style={{ background: '#04030c' }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `radial-gradient(ellipse 60% 40% at 50% 50%, ${def.accentColor}10, transparent)`,
        }} />
        <div className="relative z-10 flex flex-col items-center gap-6 text-center">
          {/* Pulsing search indicator */}
          <div className="relative w-20 h-20 flex items-center justify-center">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="absolute rounded-full border"
                style={{ borderColor: `${def.accentColor}40` }}
                animate={{ width: [40, 80], height: [40, 80], opacity: [0.8, 0] }}
                transition={{ duration: 1.8, delay: i * 0.6, repeat: Infinity, ease: 'easeOut' }}
              />
            ))}
            <Wifi size={28} style={{ color: def.accentColor }} />
          </div>
          <div>
            <p className="font-display font-black text-white text-xl">Searching for opponent</p>
            <p className="text-slate-500 text-sm mt-1">{player.character_name} · {player.character_class}</p>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full"
                style={{ background: def.accentColor }}
                animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
                transition={{ duration: 1.2, delay: i * 0.25, repeat: Infinity }}
              />
            ))}
          </div>
          <button
            onClick={disconnect}
            className="text-slate-600 text-xs hover:text-slate-400 transition-colors font-bold uppercase tracking-widest mt-2"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Phase: COUNTDOWN ─────────────────────────────────────────────────────

  if (state.phase === 'countdown') {
    return (
      <div className="fixed inset-0 z-60 flex flex-col items-center justify-center" style={{ background: '#04030c' }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 50%, ${def.accentColor}12, transparent)`,
        }} />
        <div className="relative z-10 flex flex-col items-center gap-6 text-center px-6">
          <motion.p
            className="font-display font-black uppercase"
            style={{ fontSize: '11px', letterSpacing: '0.4em', color: def.accentColor }}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          >
            Match Found
          </motion.p>

          {/* Opponent reveal */}
          {state.opponent && (
            <motion.div
              className="flex flex-col items-center gap-2"
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
            >
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center border"
                style={{ background: oppDef.accentColorDim, borderColor: `${oppDef.accentColor}30` }}>
                <span className="font-display font-black text-2xl" style={{ color: oppDef.accentColor }}>
                  {state.opponent.name.charAt(0)}
                </span>
              </div>
              <p className="font-display font-black text-white text-lg">{state.opponent.name}</p>
              <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full"
                style={{ background: oppDef.accentColorDim, color: oppDef.accentColor }}>
                {state.opponent.class}
              </span>
            </motion.div>
          )}

          {/* Countdown */}
          <AnimatePresence mode="wait">
            <motion.div
              key={state.countdown}
              className="font-display font-black"
              style={{ fontSize: 'clamp(5rem,20vw,8rem)', color: def.accentColor, textShadow: `0 0 60px ${def.accentColor}` }}
              initial={{ scale: 1.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {state.countdown}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // ── Phase: RESULT ─────────────────────────────────────────────────────────

  if (state.phase === 'result' && state.result) {
    const won = state.result.winner === 'player'
    return (
      <div className="fixed inset-0 z-60 flex flex-col items-center justify-center px-6 gap-6"
        style={{ background: '#04030c' }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          background: won
            ? 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(234,179,8,0.12), transparent)'
            : 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(239,68,68,0.1), transparent)',
        }} />
        <motion.div
          className="relative z-10 w-full max-w-sm flex flex-col items-center gap-5"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 180, damping: 14 }}
        >
          {won
            ? <Trophy size={72} className="text-amber-400" strokeWidth={1.2} />
            : <HeartCrack size={72} className="text-red-500" strokeWidth={1.2} />
          }
          <h2 className="font-display font-black text-white" style={{ fontSize: 'clamp(2.5rem,9vw,4rem)', letterSpacing: '0.1em' }}>
            {won ? 'VICTORY' : 'DEFEATED'}
          </h2>
          {state.result.reason === 'disconnect' && (
            <p className="text-slate-500 text-sm flex items-center gap-2">
              <WifiOff size={14} /> Opponent disconnected
            </p>
          )}
          <div className="w-full rounded-2xl p-5 border flex flex-col gap-3"
            style={{ background: 'rgba(8,8,14,0.95)', borderColor: 'rgba(42,42,58,0.8)' }}>
            <Stat label="XP Earned" value={`+${state.result.xp_earned}`} color={won ? '#eab308' : '#64748b'} />
            {state.result.g_earned > 0 && (
              <Stat label="G$ Earned" value={`+${state.result.g_earned}`} color="#22c55e" />
            )}
          </div>
          <div className="flex gap-3 w-full">
            <motion.button
              onClick={() => { disconnect(); connect() }}
              whileTap={{ scale: 0.96 }}
              className="flex-1 py-4 font-display font-black uppercase text-sm rounded-xl border"
              style={{
                borderColor: `${def.accentColor}40`,
                color: def.accentColor,
                background: def.accentColorDim,
                letterSpacing: '0.18em',
              }}
            >
              Rematch
            </motion.button>
            <motion.button
              onClick={() => { disconnect(); onBack() }}
              whileTap={{ scale: 0.96 }}
              className="flex-1 py-4 font-display font-black uppercase text-sm rounded-xl"
              style={{
                letterSpacing: '0.18em',
                color: '#080610',
                background: `linear-gradient(135deg, ${def.accentColor}ee, ${def.accentColor})`,
              }}
            >
              Exit
            </motion.button>
          </div>
        </motion.div>
      </div>
    )
  }

  // ── Phase: FIGHTING ───────────────────────────────────────────────────────

  return (
    <FightScreen
      player={player}
      state={state}
      def={def}
      oppDef={oppDef}
      onAction={(action) => {
        sendAction(action)
      }}
      onForfeit={() => { disconnect(); onBack() }}
    />
  )
}

// ── Fight screen ──────────────────────────────────────────────────────────────

function FightScreen({
  player, state, def, oppDef, onAction, onForfeit,
}: {
  player: Player
  state: ReturnType<typeof useGameSocket>['state']
  def: typeof CLASS_DEFINITIONS[CharacterClass]
  oppDef: typeof CLASS_DEFINITIONS[CharacterClass]
  onAction: (a: ActionType) => void
  onForfeit: () => void
}) {
  const [matchSecs, setMatchSecs] = useState(60)
  const combatFeel = useCombatFeel()
  const { playHit, playSpecial, playSwing, playBlock, startAmbient, stopAmbient } = useAudio()
  const [playerTrail, setPlayerTrail] = useState(false)
  const [opponentTrail, setOpponentTrail] = useState(false)
  const [comboCount, setComboCount] = useState(0)
  interface DmgEvent { id: number; value: number; isSpecial: boolean; side: 'player' | 'bot' }
  const [dmgEvents, setDmgEvents] = useState<DmgEvent[]>([])
  const dmgCounter = useRef(0)
  const lastActionKey = useRef('')

  useEffect(() => {
    const t = setInterval(() => setMatchSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    startAmbient()
    return () => stopAmbient()
  }, [startAmbient, stopAmbient])

  function spawnDmgNumber(value: number, side: 'player' | 'bot', isSpecial: boolean) {
    if (value <= 0) return
    const id = ++dmgCounter.current
    setDmgEvents(prev => [...prev, { id, value, isSpecial, side }])
    setTimeout(() => setDmgEvents(prev => prev.filter(e => e.id !== id)), 760)
  }

  useEffect(() => {
    if (!state.lastAction) return
    const ev = state.lastAction
    const key = `${ev.attacker}-${ev.action}-${ev.damage}-${ev.player_hp}-${ev.opponent_hp}`
    if (lastActionKey.current === key) return
    lastActionKey.current = key

    const isSpecial = ev.action === 'special'
    const attackerColor = ev.attacker === 'player' ? def.accentColor : oppDef.accentColor
    const attackerClass = ev.attacker === 'player'
      ? (player.character_class ?? 'Berserker')
      : (state.opponent?.class ?? 'Berserker')
    const hitSide = ev.attacker === 'player' ? 'bot' : 'player'

    playSwing(isSpecial)
    if (ev.attacker === 'player') {
      setPlayerTrail(true)
      setTimeout(() => setPlayerTrail(false), isSpecial ? 390 : 260)
    } else {
      setOpponentTrail(true)
      setTimeout(() => setOpponentTrail(false), isSpecial ? 390 : 260)
    }

    if (ev.damage > 0) {
      combatFeel.triggerHit(hitSide, ev.damage, attackerColor, isSpecial)
      spawnDmgNumber(ev.damage, hitSide, isSpecial)
      if (ev.attacker === 'player') setComboCount(c => c + 1)
      else setComboCount(0)
      playHit(attackerClass, ev.damage)
      if (isSpecial) playSpecial(attackerClass)
    } else if (ev.was_blocked || ev.action === 'block') {
      combatFeel.triggerBlock(hitSide, hitSide === 'player' ? def.accentColor : oppDef.accentColor)
      playBlock()
      if (ev.attacker === 'player') setComboCount(0)
    }
  }, [state.lastAction, def.accentColor, oppDef.accentColor, player.character_class, state.opponent?.class, combatFeel, playHit, playSpecial, playSwing, playBlock])

  const timerColor = matchSecs <= 10 ? '#ef4444' : matchSecs <= 20 ? '#f97316' : 'rgba(255,255,255,0.4)'
  const shakeX = combatFeel.shakeLevel >= 3 ? [-10, 9, -6, 5, 0] : combatFeel.shakeLevel >= 2 ? [-5, 5, -3, 0] : combatFeel.shakeLevel === 1 ? [-2, 2, 0] : 0
  const camScale = combatFeel.specialCam > 0 ? [1, 1.045, 1] : 1

  return (
    <motion.div
      key={combatFeel.shakeKey}
      animate={{ x: shakeX, scale: camScale }}
      transition={{ duration: combatFeel.shakeLevel >= 3 ? 0.28 : 0.18, ease: 'easeOut' }}
      className="fixed inset-0 z-60 flex flex-col overflow-hidden"
      style={{ background: '#04030c' }}
    >

      {/* ── Atmosphere ── */}
      <div className="absolute inset-0 pointer-events-none">
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
          background: `radial-gradient(ellipse 80% 100% at 50% 0%, ${oppDef.accentColor}12, transparent)`,
        }} />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
          background: `radial-gradient(ellipse 80% 100% at 50% 100%, ${def.accentColor}12, transparent)`,
        }} />
      </div>

      <WeaponTrail active={playerTrail} side="player" color={def.accentColor} special={state.lastAction?.action === 'special' && state.lastAction.attacker === 'player'} />
      <WeaponTrail active={opponentTrail} side="bot" color={oppDef.accentColor} special={state.lastAction?.action === 'special' && state.lastAction.attacker === 'opponent'} />
      <CombatOverlay color={combatFeel.overlayColor} intensity={combatFeel.overlayIntensity} side={combatFeel.overlaySide} />
      <ComboCounter count={comboCount} color={def.accentColor} />

      <div className="absolute left-0 top-0 bottom-0 w-1/2 pointer-events-none z-40">
        <AnimatePresence>
          {dmgEvents.filter(e => e.side === 'player').map(e => <DamageNumber key={e.id} {...e} />)}
        </AnimatePresence>
        <div className="absolute" style={{ left: '65%', top: '62%' }}>
          <AnimatePresence>
            {combatFeel.playerSpark && <HitSpark key={`pvp-player-spark-${combatFeel.shakeKey}`} color={combatFeel.playerSpark.color} level={combatFeel.playerSpark.level} />}
          </AnimatePresence>
          <AnimatePresence>
            {combatFeel.playerBurst && <ImpactBurst key={`pvp-player-burst-${combatFeel.shakeKey}`} color={combatFeel.playerBurst} size="md" />}
          </AnimatePresence>
        </div>
      </div>

      <div className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-none z-40">
        <AnimatePresence>
          {dmgEvents.filter(e => e.side === 'bot').map(e => <DamageNumber key={e.id} {...e} />)}
        </AnimatePresence>
        <div className="absolute" style={{ left: '35%', top: '30%' }}>
          <AnimatePresence>
            {combatFeel.botSpark && <HitSpark key={`pvp-bot-spark-${combatFeel.shakeKey}`} color={combatFeel.botSpark.color} level={combatFeel.botSpark.level} />}
          </AnimatePresence>
          <AnimatePresence>
            {combatFeel.botBurst && <ImpactBurst key={`pvp-bot-burst-${combatFeel.shakeKey}`} color={combatFeel.botBurst} size="md" />}
          </AnimatePresence>
        </div>
      </div>

      <div className="absolute inset-0">
        <IllustratedBattleScene
          playerClass={player.character_class as CharacterClass}
          playerAnim={state.playerAnim}
          playerAccentColor={def.accentColor}
          botClass={(state.opponent?.class as CharacterClass) ?? 'Berserker'}
          botAnim={state.opponentAnim}
          botAccentColor={oppDef.accentColor}
        />
      </div>

      <div className="absolute inset-x-0 top-0 z-50 flex justify-between gap-3 px-3"
        style={{
          paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
          background: 'linear-gradient(180deg, rgba(6,3,10,0.9), transparent)',
        }}>
        <DuelPlate name={player.character_name} label={player.character_class ?? 'Berserker'} hp={state.playerHp} color={def.accentColor} />
        <DuelPlate name={state.opponent?.name ?? 'Opponent'} label={state.opponent?.class ?? 'Warrior'} hp={state.opponentHp} color={oppDef.accentColor} align="right" />
      </div>

      {/* ── Center bar: timer + last action flash ── */}
      <div className="relative z-30 flex items-center justify-center py-1.5 shrink-0"
        style={{ background: 'rgba(4,3,12,0.9)', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <AnimatePresence mode="wait">
          {state.lastAction ? (
            <motion.p
              key={`${state.lastAction.attacker}-${state.lastAction.action}-${state.lastAction.damage}`}
              className="font-display font-black text-xs uppercase tracking-widest"
              style={{ color: state.lastAction.attacker === 'player' ? def.accentColor : oppDef.accentColor }}
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {state.lastAction.attacker === 'player' ? 'YOU' : 'OPPONENT'} {state.lastAction.action.toUpperCase()}
              {state.lastAction.damage > 0 && ` · −${state.lastAction.damage} HP`}
              {state.lastAction.was_blocked && ' (BLOCKED)'}
            </motion.p>
          ) : (
            <motion.p
              key="timer"
              className="font-display font-black text-xs uppercase tracking-widest"
              style={{ color: timerColor }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              {matchSecs < 10 ? `0:0${matchSecs}` : matchSecs < 60 ? `0:${matchSecs}` : '1:00'}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="relative flex-1 min-h-0 pointer-events-none" />

      {/* ── Player HP + controls ── */}
      <div className="relative z-30 flex flex-col px-4 pb-safe shrink-0"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))', background: 'rgba(4,3,12,0.95)' }}>

        <div className="pt-3 pb-2">
          <div className="flex justify-between items-center mb-1.5 px-0.5">
            <span className="font-display font-black text-[10px] uppercase tracking-widest" style={{ color: def.accentColor }}>
              {player.character_name}
            </span>
            <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">
              {player.character_class}
            </span>
          </div>
          <HpBar hp={state.playerHp} color={def.accentColor} />
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-2.5 pb-1">
          <CooldownButton
            label="Attack"  action="attack"  Icon={Sword}   color="#ef4444"
            cooldownMs={COOLDOWNS.attack}
            onPress={() => onAction('attack')}
          />
          <CooldownButton
            label="Block"   action="block"   Icon={Shield}  color="#3b82f6"
            cooldownMs={COOLDOWNS.block}
            onPress={() => onAction('block')}
          />
          <CooldownButton
            label="Special" action="special" Icon={Zap}     color="#8b5cf6"
            cooldownMs={COOLDOWNS.special}
            onPress={() => onAction('special')}
          />
        </div>

        <button onClick={onForfeit}
          className="text-[9px] text-slate-700 hover:text-slate-500 uppercase tracking-widest font-bold text-center mt-1 pb-0.5 transition-colors">
          Forfeit
        </button>
      </div>
    </motion.div>
  )
}

// ── HP bar ────────────────────────────────────────────────────────────────────

function DuelPlate({ name, label, hp, color, align = 'left' }: {
  name: string
  label: string
  hp: number
  color: string
  align?: 'left' | 'right'
}) {
  const right = align === 'right'
  return (
    <div
      className={`relative flex w-[44%] max-w-[320px] items-center gap-2 ${right ? 'flex-row-reverse text-right' : ''}`}
      style={{
        padding: '8px 10px',
        background: 'linear-gradient(180deg, rgba(66,35,13,0.9), rgba(12,6,16,0.86))',
        border: '1px solid rgba(245,188,85,0.5)',
        boxShadow: `0 0 20px ${color}28, inset 0 0 18px rgba(255,218,138,0.08)`,
        clipPath: right
          ? 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 10px 50%)'
          : 'polygon(14px 0, 100% 0, calc(100% - 10px) 50%, 100% 100%, 14px 100%, 0 50%)',
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border font-display font-black"
        style={{
          color,
          borderColor: 'rgba(245,188,85,0.75)',
          background: `radial-gradient(circle, ${color}40, rgba(0,0,0,0.7))`,
          boxShadow: `0 0 16px ${color}70`,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display font-black leading-none" style={{ color: '#fff2cf', fontSize: 12 }}>
          {name}
        </p>
        <p className="mt-0.5 truncate text-[8px] font-black uppercase tracking-[0.22em]" style={{ color: '#f8d58a' }}>
          {label}
        </p>
        <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: 'rgba(10,5,8,0.86)', border: '1px solid rgba(245,188,85,0.16)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${color}88, ${color})`, boxShadow: `0 0 8px ${color}` }}
            animate={{ width: `${hp}%` }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          />
        </div>
      </div>
      <span className="font-display font-black text-xs" style={{ color: '#fff2cf' }}>{hp}</span>
    </div>
  )
}

function HpBar({ hp, color, flip = false }: { hp: number; color: string; flip?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {flip && <span className="font-black text-white text-xs w-8 text-right shrink-0">{hp}</span>}
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(18,18,26,0.9)', border: '1px solid rgba(42,42,58,0.5)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}88, ${color})`, boxShadow: `0 0 6px ${color}60`, transformOrigin: flip ? 'right' : 'left' }}
          animate={{ scaleX: hp / 100 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      </div>
      {!flip && <span className="font-black text-white text-xs w-8 shrink-0">{hp}</span>}
    </div>
  )
}

// ── Cooldown button ───────────────────────────────────────────────────────────

function CooldownButton({
  label, Icon, color, cooldownMs, onPress,
}: {
  label: string
  action: ActionType
  Icon: typeof Sword
  color: string
  cooldownMs: number
  onPress: () => void
}) {
  const [remaining, setRemaining] = useState(0)
  const [total, setTotal]         = useState(0)
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null)

  const press = useCallback(() => {
    if (remaining > 0) return
    onPress()
    setTotal(cooldownMs)
    setRemaining(cooldownMs)
    const start = Date.now()
    intervalRef.current = setInterval(() => {
      const left = cooldownMs - (Date.now() - start)
      if (left <= 0) {
        clearInterval(intervalRef.current!)
        intervalRef.current = null
        setRemaining(0)
      } else {
        setRemaining(left)
      }
    }, 40)
  }, [remaining, cooldownMs, onPress])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  const isOnCooldown = remaining > 0
  const progress     = total > 0 ? remaining / total : 0 // 1=just pressed, 0=ready

  return (
    <motion.button
      onClick={press}
      whileTap={isOnCooldown ? {} : { scale: 0.94 }}
      className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl border overflow-hidden transition-opacity"
      style={{
        background:   isOnCooldown ? 'rgba(8,8,14,0.6)' : 'rgba(8,8,14,0.95)',
        borderColor:  isOnCooldown ? 'rgba(42,42,58,0.4)' : `${color}35`,
        opacity:      isOnCooldown ? 0.55 : 1,
        cursor:       isOnCooldown ? 'not-allowed' : 'pointer',
      }}
    >
      {/* Radial cooldown sweep overlay (conic-gradient sweeps away as cooldown expires) */}
      {isOnCooldown && (
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            background: `conic-gradient(rgba(0,0,0,0.65) ${progress * 360}deg, transparent ${progress * 360}deg)`,
          }}
        />
      )}

      {/* Glow on hover */}
      {!isOnCooldown && (
        <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}14, transparent 65%)` }} />
      )}

      <div className="relative z-10 w-9 h-9 rounded-lg flex items-center justify-center"
        style={{ background: `${color}12`, border: `1px solid ${color}25` }}>
        <Icon size={18} style={{ color: isOnCooldown ? '#4a4a5a' : color }} strokeWidth={1.8} />
      </div>
      <span className="relative z-10 font-black text-white text-xs"
        style={{ color: isOnCooldown ? '#4a4a5a' : undefined }}>
        {label}
      </span>
    </motion.button>
  )
}

// ── Stat row ──────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className="font-black text-sm" style={{ color }}>{value}</span>
    </div>
  )
}
