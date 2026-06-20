'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useAnimation } from 'framer-motion'
import { Sword, Shield, Zap, MoveRight } from 'lucide-react'
import type { Player } from '@/types'
import type { CharacterClass } from '@/lib/classes'
import { CLASS_DEFINITIONS } from '@/lib/classes'
import { SPECIAL_METER_THRESHOLD } from '@/lib/combat/constants'
import { useCombatEngine } from '@/hooks/combat/useCombatEngine'
import { useCombatFeel } from '@/hooks/useCombatFeel'
import { useAudio } from '@/hooks/useAudio'
import RealtimeBattleScene from './RealtimeBattleScene'
import ImpactBurst from './ImpactBurst'
import HitSpark from './HitSpark'
import DamageNumber from './DamageNumber'
import SpeedLines from './SpeedLines'
import GroundShockwave from './GroundShockwave'
import ScreenFlash from './ScreenFlash'
export interface BossConfig {
  name: string
  title: string
  damageMult: number
  hpMult: number
  reactionMult: number
  accentColor: string
}

interface Props {
  player: Player
  walletAddress?: string
  botClass: CharacterClass
  bossConfig?: BossConfig
  onFinish: (won: boolean, stats: { hitsLanded: number; maxCombo: number; elapsed: number }) => void
  onBack?: () => void
}

// ── Frame loop bridge — connects React state to requestAnimationFrame ────────

function useGameLoop(callback: (deltaMs: number) => void, active: boolean) {
  const cbRef = useRef(callback)
  cbRef.current = callback
  const lastTime = useRef(0)

  useEffect(() => {
    if (!active) return
    let raf: number
    function loop(time: number) {
      const delta = lastTime.current ? Math.min(time - lastTime.current, 50) : 16.67
      lastTime.current = time
      cbRef.current(delta)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
}

// ── Damage number events ─────────────────────────────────────────────────────

interface DmgEvent { id: number; value: number; isSpecial: boolean; side: 'player' | 'bot' }

export default function RealtimeBattleArena({ player, botClass, bossConfig, onFinish }: Props) {
  const playerClass = (player.character_class as CharacterClass) ?? 'Berserker'
  const playerDef = CLASS_DEFINITIONS[playerClass] ?? CLASS_DEFINITIONS.Berserker
  const botDef = CLASS_DEFINITIONS[botClass]
  const botDisplayName = bossConfig ? `${bossConfig.name}` : `Bot ${botClass}`
  const botAccent = bossConfig?.accentColor ?? botDef.accentColor

  const engine = useCombatEngine(player.rank, bossConfig ? {
    damageMult: bossConfig.damageMult,
    hpMult: bossConfig.hpMult,
    reactionMult: bossConfig.reactionMult,
  } : undefined)
  const combatFeel = useCombatFeel()
  const audio = useAudio()
  const shakeControls = useAnimation()
  const camControls = useAnimation()

  const [dmgEvents, setDmgEvents] = useState<DmgEvent[]>([])
  const dmgCounter = useRef(0)
  const [started, setStarted] = useState(false)
  const [showIntro, setShowIntro] = useState(true)
  const resultReported = useRef(false)

  // ── VFX state ─────────────────────────────────────────────────────────
  interface VfxFlash { id: number; color: string; intensity: 'light' | 'heavy' | 'ko' }
  interface VfxSpeedLine { id: number; color: string; direction: 'left' | 'right'; intensity: 'light' | 'heavy' | 'special' }
  interface VfxShockwave { id: number; color: string; size: 'small' | 'medium' | 'large'; side: 'player' | 'bot' }

  const [flashes, setFlashes] = useState<VfxFlash[]>([])
  const [speedLines, setSpeedLines] = useState<VfxSpeedLine[]>([])
  const [shockwaves, setShockwaves] = useState<VfxShockwave[]>([])
  const vfxCounter = useRef(0)

  const prevPlayerHp = useRef(100)
  const heartbeatActive = useRef(false)

  // ── Start fight on mount ─────────────────────────────────────────────────
  useEffect(() => {
    engine.startFight(playerClass, botClass, player.rank)
    audio.startAmbient()
    setStarted(true)

    const introTimer = setTimeout(() => setShowIntro(false), 2000)
    return () => {
      clearTimeout(introTimer)
      audio.stopAmbient()
      audio.stopHeartbeat()
    }
  }, [])

  // ── Game loop ────────────────────────────────────────────────────────────
  useGameLoop((deltaMs) => {
    engine.tick(deltaMs)
  }, started && engine.state.phase !== 'result')

  // ── Dodge / block audio on state changes ─────────────────────────────────
  const prevPlayerState = useRef(engine.state.player.state)
  useEffect(() => {
    const cur = engine.state.player.state
    const prev = prevPlayerState.current
    if (cur !== prev) {
      if (cur === 'dodging') audio.playDodge()
      if (cur === 'blocking' && prev !== 'blocking') audio.playBlock()
    }
    prevPlayerState.current = cur
  }, [engine.state.player.state])

  // ── Low HP heartbeat ─────────────────────────────────────────────────────
  useEffect(() => {
    const hp = engine.state.player.hp
    if (hp <= 25 && hp > 0 && !heartbeatActive.current) {
      heartbeatActive.current = true
      audio.startHeartbeat()
    } else if ((hp > 25 || hp <= 0) && heartbeatActive.current) {
      heartbeatActive.current = false
      audio.stopHeartbeat()
    }
    prevPlayerHp.current = hp
  }, [engine.state.player.hp])

  // ── Process hit events → VFX + audio ─────────────────────────────────────
  useEffect(() => {
    if (engine.hitEvents.length === 0) return

    for (const hit of engine.hitEvents) {
      const attackerColor = hit.attacker === 'player' ? playerDef.accentColor : botAccent
      const defenderSide = hit.defender
      const isHeavy = hit.move.id === 'heavy_attack'
      const isSpecial = hit.move.id === 'special'

      // Combat feel — scaled up for heavy/special
      combatFeel.triggerHit(defenderSide, isSpecial ? hit.damage * 2 : hit.damage, attackerColor, isSpecial)

      // Damage number
      if (hit.damage > 0) {
        const id = ++dmgCounter.current
        setDmgEvents(prev => [...prev, {
          id, value: hit.damage, isSpecial, side: defenderSide,
        }])
        setTimeout(() => setDmgEvents(prev => prev.filter(e => e.id !== id)), 700)
      }

      // Audio — differentiated by move type
      if (hit.blocked) {
        audio.playBlock()
      } else if (hit.comboCount >= 2) {
        audio.playComboHit(hit.comboCount)
      } else {
        audio.playHit(hit.attacker === 'player' ? playerClass : botClass, hit.damage)
      }

      if (isSpecial) {
        audio.playSpecial(hit.attacker === 'player' ? playerClass : botClass)
      }

      // Speed lines on attacks
      if (!hit.blocked && hit.damage > 0) {
        const slId = ++vfxCounter.current
        const slDir = hit.attacker === 'player' ? 'right' : 'left'
        const slIntensity = isSpecial ? 'special' : isHeavy ? 'heavy' : 'light'
        setSpeedLines(prev => [...prev, { id: slId, color: attackerColor, direction: slDir as 'left' | 'right', intensity: slIntensity as 'light' | 'heavy' | 'special' }])
        setTimeout(() => setSpeedLines(prev => prev.filter(e => e.id !== slId)), 300)
      }

      // Ground shockwave on heavy + special
      if ((isHeavy || isSpecial) && !hit.blocked && hit.damage > 0) {
        const swId = ++vfxCounter.current
        const swSize = isSpecial ? 'large' : 'medium'
        setShockwaves(prev => [...prev, { id: swId, color: attackerColor, size: swSize as 'small' | 'medium' | 'large', side: defenderSide }])
        setTimeout(() => setShockwaves(prev => prev.filter(e => e.id !== swId)), 500)
      }

      // Screen flash on special and KO
      if (isSpecial || hit.isKO) {
        const fId = ++vfxCounter.current
        const fIntensity = hit.isKO ? 'ko' : 'heavy'
        setFlashes(prev => [...prev, { id: fId, color: hit.isKO ? '#ffffff' : attackerColor, intensity: fIntensity as 'light' | 'heavy' | 'ko' }])
        setTimeout(() => setFlashes(prev => prev.filter(e => e.id !== fId)), 600)
      }

      // KO
      if (hit.isKO) {
        audio.playKOImpact()
        setTimeout(() => {
          if (hit.defender === 'bot') audio.playVictory()
          else audio.playDefeat()
        }, 400)
      }
    }
  }, [engine.hitEvents])

  // ── Shake on hits — scaled by combo ──────────────────────────────────────
  useEffect(() => {
    if (combatFeel.shakeLevel === 0) return
    const comboBoost = Math.min(engine.state.player.comboCount * 0.3, 2)
    const baseX = combatFeel.shakeLevel >= 3 ? [-12, 11, -8, 8, -4, 4, 0]
      : combatFeel.shakeLevel >= 2 ? [-6, 6, -4, 4, 0]
      : [-3, 3, -2, 2, 0]
    const x = baseX.map(v => Math.round(v * (1 + comboBoost)))
    const rotate = combatFeel.shakeLevel >= 3 ? [-0.7, 0.6, -0.5, 0.4, -0.2, 0.2, 0] : 0
    shakeControls.start({
      x, rotate,
      transition: { duration: combatFeel.shakeLevel >= 3 ? 0.26 : 0.18, ease: 'easeOut' },
    })
  }, [combatFeel.shakeKey])

  // ── Camera zoom on special ───────────────────────────────────────────────
  useEffect(() => {
    if (combatFeel.specialCam === 0) return
    camControls.start({
      scale: [1, 1.08, 1.03, 1],
      transition: { duration: 0.6, ease: 'easeInOut' },
    })
  }, [combatFeel.specialCam])

  // ── Report result ────────────────────────────────────────────────────────
  useEffect(() => {
    if (engine.state.phase === 'result' && !resultReported.current) {
      resultReported.current = true
      audio.stopAmbient()
      audio.stopHeartbeat()
      onFinish(engine.playerWon(), {
        hitsLanded: engine.state.playerHitsLanded,
        maxCombo: engine.state.maxCombo,
        elapsed: engine.state.elapsedMs,
      })
    }
  }, [engine.state.phase])

  // ── Get animation state ──────────────────────────────────────────────────
  const playerAnim = engine.getPlayerAnim()
  const botAnim = engine.getBotAnim()
  const s = engine.state

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={{ background: '#04030c' }}>

      {/* ── Screen flashes ── */}
      <AnimatePresence>
        {flashes.map(f => (
          <ScreenFlash key={f.id} color={f.color} intensity={f.intensity} />
        ))}
      </AnimatePresence>

      {/* ── 3D Scene ── */}
      <motion.div animate={shakeControls} className="absolute inset-0">
       <motion.div animate={camControls} className="absolute inset-0">
        <RealtimeBattleScene
          playerClass={playerClass}
          playerAccentColor={playerDef.accentColor}
          playerPositionX={s.player.positionX}
          playerAnimClip={playerAnim.clip}
          playerAnimSpeed={playerAnim.speed}
          playerBlocking={s.player.state === 'blocking'}
          playerDead={s.player.state === 'dead'}
          botClass={botClass}
          botAccentColor={botAccent}
          botPositionX={s.bot.positionX}
          botAnimClip={botAnim.clip}
          botAnimSpeed={botAnim.speed}
          botBlocking={s.bot.state === 'blocking'}
          botDead={s.bot.state === 'dead'}
          timeScale={s.timeScale}
        />

        {/* ── DOM overlays for VFX ── */}
        <div className="absolute left-0 top-0 bottom-0 w-1/2 pointer-events-none z-10">
          <AnimatePresence>
            {dmgEvents.filter(e => e.side === 'player').map(e => (
              <DamageNumber key={e.id} {...e} />
            ))}
          </AnimatePresence>
          <AnimatePresence>
            {combatFeel.playerFlash && (
              <motion.div key="pf" className="absolute inset-0"
                style={{ background: `radial-gradient(circle at 0% 55%, ${combatFeel.playerFlash}45, transparent 65%)` }}
                initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }} />
            )}
          </AnimatePresence>
          <div className="absolute" style={{ left: '78%', top: '40%' }}>
            <AnimatePresence>
              {combatFeel.playerSpark && (
                <HitSpark key={`ps-${combatFeel.shakeKey}`} color={combatFeel.playerSpark.color} level={combatFeel.playerSpark.level} />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {combatFeel.playerBurst && (
                <ImpactBurst key={`pb-${combatFeel.shakeKey}`} color={combatFeel.playerBurst} size="md" />
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-none z-10">
          <AnimatePresence>
            {dmgEvents.filter(e => e.side === 'bot').map(e => (
              <DamageNumber key={e.id} {...e} />
            ))}
          </AnimatePresence>
          <AnimatePresence>
            {combatFeel.botFlash && (
              <motion.div key="bf" className="absolute inset-0"
                style={{ background: `radial-gradient(circle at 100% 55%, ${combatFeel.botFlash}45, transparent 65%)` }}
                initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }} />
            )}
          </AnimatePresence>
          <div className="absolute" style={{ left: '22%', top: '40%' }}>
            <AnimatePresence>
              {combatFeel.botSpark && (
                <HitSpark key={`bs-${combatFeel.shakeKey}`} color={combatFeel.botSpark.color} level={combatFeel.botSpark.level} />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {combatFeel.botBurst && (
                <ImpactBurst key={`bb-${combatFeel.shakeKey}`} color={combatFeel.botBurst} size="md" />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Speed lines */}
        <AnimatePresence>
          {speedLines.map(sl => (
            <SpeedLines key={sl.id} color={sl.color} direction={sl.direction} intensity={sl.intensity} />
          ))}
        </AnimatePresence>

        {/* Ground shockwaves */}
        {shockwaves.map(sw => (
          <div key={sw.id} className="absolute z-15 pointer-events-none"
            style={{
              left: sw.side === 'bot' ? '62%' : '38%',
              top: '65%',
            }}>
            <GroundShockwave color={sw.color} size={sw.size} />
          </div>
        ))}

        {/* Low HP blood vignette — enhanced with desaturation */}
        {s.player.hp <= 30 && s.player.hp > 0 && (
          <>
            <motion.div className="absolute inset-0 pointer-events-none z-20"
              style={{
                background: `radial-gradient(ellipse at center, transparent 30%, rgba(180,0,0,${0.15 + (1 - s.player.hp / 30) * 0.25}) 100%)`,
              }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
            />
            {/* Edge darkening at critical HP */}
            {s.player.hp <= 15 && (
              <motion.div className="absolute inset-0 pointer-events-none z-20"
                style={{
                  background: 'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.4) 100%)',
                }}
                animate={{ opacity: [0.5, 0.8, 0.5] }}
                transition={{ duration: 0.6, repeat: Infinity }}
              />
            )}
          </>
        )}
       </motion.div>
      </motion.div>

      {/* ── Intro overlay ── */}
      <AnimatePresence>
        {showIntro && (
          <motion.div key="intro"
            className="absolute inset-0 z-40 flex flex-col items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}>
            <motion.p className="font-display font-bold uppercase"
              style={{ fontSize: '9px', letterSpacing: '0.5em', color: 'rgba(234,179,8,0.55)' }}
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.35 }}>
              Valor Arena
            </motion.p>
            <div className="flex items-center gap-4 mt-2">
              <motion.span className="font-display font-black"
                style={{ fontSize: 'clamp(1.1rem, 4.5vw, 1.8rem)', color: playerDef.accentColor }}
                initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.45 }}>
                {player.character_name}
              </motion.span>
              <span className="font-display font-black text-slate-600"
                style={{ fontSize: 'clamp(1rem, 3.5vw, 1.5rem)' }}>VS</span>
              <motion.span className="font-display font-black"
                style={{ fontSize: 'clamp(1.1rem, 4.5vw, 1.8rem)', color: botAccent }}
                initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.45 }}>
                {botDisplayName}
              </motion.span>
            </div>
            <motion.h2 className="font-display font-black tracking-widest mt-4"
              style={{
                fontSize: 'clamp(3.5rem, 12vw, 6rem)',
                color: '#eab308',
                textShadow: '0 0 60px #eab308, 0 0 100px rgba(234,179,8,0.6)',
              }}
              initial={{ scale: 2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ delay: 0.8, duration: 0.3 }}>
              FIGHT
            </motion.h2>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── KO overlay ── */}
      <AnimatePresence>
        {s.phase === 'ko' && (
          <motion.div key="ko"
            className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.h2 className="font-display font-black tracking-widest"
              style={{
                fontSize: 'clamp(4rem, 16vw, 8rem)',
                color: engine.playerWon() ? '#eab308' : '#ef4444',
                textShadow: `0 0 80px ${engine.playerWon() ? '#eab308' : '#ef4444'}`,
              }}
              initial={{ scale: 3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
              {engine.playerWon() ? 'K.O.!' : 'DEFEATED'}
            </motion.h2>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Combo counter ── */}
      <AnimatePresence>
        {s.player.comboCount >= 2 && s.phase === 'fighting' && (
          <motion.div key={`combo-${s.player.comboCount}`}
            className="absolute z-30 pointer-events-none"
            style={{ left: '8%', top: '35%' }}
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}>
            <p className="font-display font-black text-amber-400"
              style={{ fontSize: 'clamp(1.5rem, 6vw, 3rem)', textShadow: '0 0 30px rgba(234,179,8,0.6)' }}>
              {s.player.comboCount}×
            </p>
            <p className="font-black text-amber-400/60 uppercase tracking-widest"
              style={{ fontSize: '10px' }}>
              COMBO
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── HUD — Top bar ── */}
      {s.phase === 'fighting' && (
        <div className="absolute inset-x-0 top-0 z-30 px-3"
          style={{
            paddingTop: 'max(10px, env(safe-area-inset-top, 10px))',
            background: 'linear-gradient(180deg, rgba(4,3,12,0.85) 0%, rgba(4,3,12,0.5) 70%, transparent 100%)',
          }}>

          <div className="flex items-start justify-between gap-2">
            {/* Player HP + Stamina + Special */}
            <FighterHUD
              name={player.character_name}
              classLabel={playerClass}
              color={playerDef.accentColor}
              hp={s.player.hp}
              maxHp={s.player.maxHp}
              stamina={s.player.stamina}
              maxStamina={s.player.maxStamina}
              specialMeter={s.player.specialMeter}
              side="left"
            />

            {/* Timer */}
            <div className="flex flex-col items-center pt-1">
              <span className="font-display font-black text-white text-lg leading-none">
                {Math.max(0, Math.ceil((60000 - s.elapsedMs) / 1000))}
              </span>
              <span className="text-[7px] font-bold uppercase tracking-[0.25em] text-slate-600">TIME</span>
            </div>

            {/* Bot HP + Stamina + Special */}
            <FighterHUD
              name={botDisplayName}
              classLabel={botClass}
              color={botAccent}
              hp={s.bot.hp}
              maxHp={s.bot.maxHp}
              stamina={s.bot.stamina}
              maxStamina={s.bot.maxStamina}
              specialMeter={s.bot.specialMeter}
              side="right"
            />
          </div>
        </div>
      )}

      {/* ── On-screen controls (mobile + desktop) ── */}
      {s.phase === 'fighting' && (
        <div className="absolute inset-x-0 bottom-0 z-30 px-3"
          style={{
            paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
            paddingTop: 8,
            background: 'linear-gradient(0deg, rgba(4,3,12,0.85) 0%, rgba(4,3,12,0.5) 60%, transparent 100%)',
          }}>

          {/* Controls hint (desktop) */}
          <div className="hidden lg:flex justify-center gap-6 mb-2">
            {[
              { key: 'J', label: 'Light Attack' },
              { key: 'K', label: 'Heavy Attack' },
              { key: 'L', label: 'Block (hold)' },
              { key: 'Space', label: 'Dodge' },
              { key: 'Q', label: 'Special' },
            ].map(({ key, label }) => (
              <span key={key} className="text-[8px] text-slate-600">
                <span className="text-slate-400 font-bold">[{key}]</span> {label}
              </span>
            ))}
          </div>

          {/* Touch buttons */}
          <div className="grid grid-cols-5 gap-1.5 lg:hidden">
            <ActionButton
              icon={<Sword size={20} />}
              label="Attack"
              color="#ef4444"
              onPress={() => engine.emitAction('light_attack')}
            />
            <ActionButton
              icon={<Sword size={20} strokeWidth={3} />}
              label="Heavy"
              color="#f97316"
              onPress={() => engine.emitAction('heavy_attack')}
            />
            <ActionButton
              icon={<Shield size={20} />}
              label="Block"
              color="#3b82f6"
              onPress={() => engine.emitAction('block_start')}
              onRelease={() => engine.emitAction('block_end')}
            />
            <ActionButton
              icon={<MoveRight size={20} />}
              label="Dodge"
              color="#22c55e"
              disabled={s.player.stamina < 20}
              onPress={() => engine.emitAction('dodge')}
            />
            <ActionButton
              icon={<Zap size={20} />}
              label="Special"
              color="#8b5cf6"
              disabled={s.player.specialUsed || s.player.specialMeter < SPECIAL_METER_THRESHOLD}
              glow={!s.player.specialUsed && s.player.specialMeter >= SPECIAL_METER_THRESHOLD}
              onPress={() => engine.emitAction('special')}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function FighterHUD({ name, classLabel, color, hp, maxHp, stamina, maxStamina, specialMeter, side }: {
  name: string; classLabel: string; color: string
  hp: number; maxHp: number; stamina: number; maxStamina: number
  specialMeter: number; side: 'left' | 'right'
}) {
  const hpPct = Math.max(0, hp / maxHp * 100)
  const staminaPct = Math.max(0, stamina / maxStamina * 100)
  const specialPct = Math.min(100, specialMeter)
  const hpColor = hpPct > 60 ? color : hpPct > 30 ? '#f59e0b' : '#ef4444'
  const isCritical = hpPct <= 30

  return (
    <div className={`flex flex-col gap-0.5 ${side === 'right' ? 'items-end' : 'items-start'}`}
      style={{ minWidth: 120, maxWidth: 170 }}>

      <div className={`flex items-center gap-1.5 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
        <div className="w-6 h-6 rounded-full border flex items-center justify-center shrink-0 font-black"
          style={{ borderColor: `${color}60`, background: `${color}18`, color, fontSize: 9 }}>
          ⚔
        </div>
        <div className={side === 'right' ? 'text-right' : ''}>
          <p className="font-black text-white leading-none" style={{ fontSize: 9 }}>{name}</p>
          <p className="font-bold uppercase" style={{ fontSize: 6, letterSpacing: '0.18em', color }}>{classLabel}</p>
        </div>
      </div>

      {/* HP bar */}
      <div className="w-full">
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(42,42,58,0.7)' }}>
          <motion.div className="h-full rounded-full"
            style={{
              background: `linear-gradient(90deg, ${hpColor}90, ${hpColor})`,
              boxShadow: isCritical ? `0 0 8px ${hpColor}` : 'none',
            }}
            animate={{ width: `${hpPct}%` }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          />
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="font-black" style={{ fontSize: 8, color: hpColor }}>
            {Math.ceil(hp)}<span className="text-slate-500 font-normal" style={{ fontSize: 7 }}> HP</span>
          </span>
        </div>
      </div>

      {/* Stamina bar */}
      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(42,42,58,0.5)' }}>
        <motion.div className="h-full rounded-full"
          style={{ background: staminaPct > 20 ? '#22c55e' : '#ef4444' }}
          animate={{ width: `${staminaPct}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      {/* Special meter */}
      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(42,42,58,0.5)' }}>
        <motion.div className="h-full rounded-full"
          style={{
            background: specialPct >= SPECIAL_METER_THRESHOLD
              ? 'linear-gradient(90deg, #8b5cf6, #a855f7)'
              : '#8b5cf650',
            boxShadow: specialPct >= SPECIAL_METER_THRESHOLD ? '0 0 6px #8b5cf6' : 'none',
          }}
          animate={{ width: `${specialPct}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>
    </div>
  )
}

function ActionButton({ icon, label, color, disabled, glow, onPress, onRelease }: {
  icon: React.ReactNode; label: string; color: string
  disabled?: boolean; glow?: boolean
  onPress: () => void; onRelease?: () => void
}) {
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); if (!disabled) onPress() }}
      onPointerUp={(e) => { e.preventDefault(); onRelease?.() }}
      onPointerLeave={() => { onRelease?.() }}
      disabled={disabled}
      className="relative flex flex-col items-center gap-1 py-3 rounded-xl border overflow-hidden active:scale-95 transition-transform"
      style={{
        background: disabled ? 'rgba(8,8,14,0.4)' : 'rgba(6,5,16,0.9)',
        borderColor: disabled ? 'rgba(42,42,58,0.3)' : `${color}45`,
        opacity: disabled ? 0.3 : 1,
        boxShadow: glow ? `0 0 20px ${color}40, inset 0 0 15px ${color}15` : 'none',
        touchAction: 'none',
      }}>
      {!disabled && (
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}10, transparent 60%)` }} />
      )}
      <div className="relative z-10" style={{ color: disabled ? '#4a4a5a' : color }}>
        {icon}
      </div>
      <span className="relative z-10 font-black text-white" style={{ fontSize: 8 }}>{label}</span>
    </button>
  )
}
