'use client'

import { useState, useRef, useCallback } from 'react'
import type { CombatState, HitEvent, Fighter, CombatPhase } from '@/lib/combat/types'
import type { CharacterClass } from '@/lib/classes'
import {
  HIT_RANGE,
  KO_SLOWMO_MS, KO_SLOWMO_SCALE,
  INTRO_DURATION_MS, KO_TO_RESULT_DELAY_MS, FIGHT_TIME_LIMIT_MS,
  COMBO_DROP_MS,
} from '@/lib/combat/constants'
import { isInActiveFrames } from '@/lib/combat/moves'
import {
  createFighter, applyAction, resolveHit,
  applyHitToDefender, applyHitToAttacker, tickFighter, getFighterAnim,
} from './useFighterState'
import { useInputSystem } from './useInputSystem'
import { useBotAI } from './useBotAI'

export interface DifficultyConfig {
  damageMult: number
  hpMult: number
  reactionMult: number
}

/** Lightweight snapshot for React HUD — only values the UI needs. */
export interface HudSnapshot {
  phase: CombatPhase
  playerHp: number
  playerMaxHp: number
  playerStamina: number
  playerMaxStamina: number
  playerSpecialMeter: number
  playerSpecialUsed: boolean
  playerComboCount: number
  playerState: string
  botHp: number
  botMaxHp: number
  botStamina: number
  botMaxStamina: number
  botSpecialMeter: number
  botState: string
  elapsedMs: number
  timeScale: number
  playerHitsLanded: number
  botHitsLanded: number
  maxCombo: number
}

interface CombatEngineResult {
  /** Lightweight HUD data — updates at throttled rate */
  hud: HudSnapshot
  /** Full state ref for synchronous reads (3D scene, VFX) */
  stateRef: React.RefObject<CombatState>
  /** Queued hit events for VFX/audio */
  hitEvents: HitEvent[]
  startFight: (playerClass: CharacterClass, botClass: CharacterClass, rank: string) => void
  tick: (deltaMs: number) => void
  getPlayerAnim: () => { clip: string; speed: number }
  getBotAnim: () => { clip: string; speed: number }
  reset: () => void
  emitAction: (action: import('@/lib/combat/types').CombatAction) => void
  playerWon: () => boolean
}

function createInitialState(): CombatState {
  return {
    phase: 'intro',
    player: createFighter('player', 'Berserker'),
    bot: createFighter('bot', 'Sentinel'),
    elapsedMs: 0,
    timeScale: 1.0,
    slowMoUntil: 0,
    playerHitsLanded: 0,
    botHitsLanded: 0,
    maxCombo: 0,
    resultSubmitted: false,
  }
}

function snapshotHud(s: CombatState): HudSnapshot {
  return {
    phase: s.phase,
    playerHp: s.player.hp,
    playerMaxHp: s.player.maxHp,
    playerStamina: s.player.stamina,
    playerMaxStamina: s.player.maxStamina,
    playerSpecialMeter: s.player.specialMeter,
    playerSpecialUsed: s.player.specialUsed,
    playerComboCount: s.player.comboCount,
    playerState: s.player.state,
    botHp: s.bot.hp,
    botMaxHp: s.bot.maxHp,
    botStamina: s.bot.stamina,
    botMaxStamina: s.bot.maxStamina,
    botSpecialMeter: s.bot.specialMeter,
    botState: s.bot.state,
    elapsedMs: s.elapsedMs,
    timeScale: s.timeScale,
    playerHitsLanded: s.playerHitsLanded,
    botHitsLanded: s.botHitsLanded,
    maxCombo: s.maxCombo,
  }
}

const HUD_THROTTLE_MS = 66 // ~15fps for React renders

export function useCombatEngine(rank: string, difficulty?: DifficultyConfig): CombatEngineResult {
  const stateRef = useRef<CombatState>(createInitialState())
  const [hud, setHud] = useState<HudSnapshot>(() => snapshotHud(stateRef.current))
  const hitEventsRef = useRef<HitEvent[]>([])
  const [hitEvents, setHitEvents] = useState<HitEvent[]>([])
  const introStartRef = useRef(0)
  const koTimeRef = useRef(0)
  const lastComboHitTime = useRef(0)
  const lastHudFlush = useRef(0)
  const diffRef = useRef<DifficultyConfig | undefined>(difficulty)
  diffRef.current = difficulty

  const input = useInputSystem(stateRef.current.phase === 'fighting')
  const botAI = useBotAI(rank)

  // Flush hit events immediately (they trigger VFX/audio),
  // but throttle HUD updates to ~15fps.
  const flushHits = useCallback(() => {
    if (hitEventsRef.current.length > 0) {
      setHitEvents([...hitEventsRef.current])
      hitEventsRef.current = []
    }
  }, [])

  const flushHud = useCallback((force?: boolean) => {
    const now = performance.now()
    if (force || now - lastHudFlush.current >= HUD_THROTTLE_MS) {
      lastHudFlush.current = now
      setHud(snapshotHud(stateRef.current))
    }
  }, [])

  const startFight = useCallback((
    playerClass: CharacterClass,
    botClass: CharacterClass,
    _playerRank: string,
  ) => {
    const s = createInitialState()
    s.player = createFighter('player', playerClass)
    s.bot = createFighter('bot', botClass)

    const diff = diffRef.current
    if (diff) {
      const bossHp = Math.round(s.bot.maxHp * diff.hpMult)
      s.bot.hp = bossHp
      s.bot.maxHp = bossHp
    }

    s.phase = 'intro'
    introStartRef.current = performance.now()
    koTimeRef.current = 0
    lastComboHitTime.current = 0
    stateRef.current = s
    botAI.init(botClass)
    flushHud(true)
  }, [botAI, flushHud])

  const emitAction = useCallback((action: import('@/lib/combat/types').CombatAction) => {
    input.emit(action)
  }, [input])

  const reset = useCallback(() => {
    stateRef.current = createInitialState()
    flushHud(true)
  }, [flushHud])

  const playerWon = useCallback(() => {
    const s = stateRef.current
    if (s.phase !== 'result' && s.phase !== 'ko') return false
    return s.player.hp > s.bot.hp
  }, [])

  const getPlayerAnim = useCallback(() => getFighterAnim(stateRef.current.player), [])
  const getBotAnim = useCallback(() => getFighterAnim(stateRef.current.bot), [])

  const tick = useCallback((rawDeltaMs: number) => {
    const s = stateRef.current
    const now = performance.now()

    // ── Intro phase ──────────────────────────────────────────────────────
    if (s.phase === 'intro') {
      if (now - introStartRef.current >= INTRO_DURATION_MS) {
        s.phase = 'fighting'
        flushHud(true)
      }
      return
    }

    // ── KO phase ─────────────────────────────────────────────────────────
    if (s.phase === 'ko') {
      if (now - koTimeRef.current >= KO_TO_RESULT_DELAY_MS) {
        s.phase = 'result'
        s.timeScale = 1.0
        flushHud(true)
      }
      return
    }

    if (s.phase !== 'fighting') return

    // ── Time scaling ─────────────────────────────────────────────────────
    if (now >= s.slowMoUntil) s.timeScale = 1.0
    const deltaMs = rawDeltaMs * s.timeScale
    s.elapsedMs += deltaMs

    // ── Time limit ───────────────────────────────────────────────────────
    if (s.elapsedMs >= FIGHT_TIME_LIMIT_MS) {
      s.phase = 'ko'
      koTimeRef.current = now
      if (s.player.hp <= s.bot.hp && s.player.state !== 'dead') {
        s.player.state = 'dead'; s.player.stateStartedAt = now
      }
      if (s.bot.hp <= s.player.hp && s.bot.state !== 'dead') {
        s.bot.state = 'dead'; s.bot.stateStartedAt = now
      }
      flushHud(true)
      return
    }

    // ── Combo drop ───────────────────────────────────────────────────────
    if (s.player.comboCount > 0 && now - lastComboHitTime.current > COMBO_DROP_MS) {
      s.player.comboCount = 0
    }

    // ── Player input ─────────────────────────────────────────────────────
    const playerAction = input.consume()
    if (playerAction) {
      s.player = applyAction(s.player, playerAction, now)
    }
    if (input.isBlocking() && s.player.state !== 'blocking' && s.player.state === 'idle') {
      s.player = applyAction(s.player, 'block_start', now)
    }

    // ── Bot AI ───────────────────────────────────────────────────────────
    const botAction = botAI.decide(s.bot, s.player, now)
    if (botAction) {
      s.bot = applyAction(s.bot, botAction, now)
    }

    // ── Tick state machines ──────────────────────────────────────────────
    s.player = tickFighter(s.player, now, deltaMs)
    s.bot = tickFighter(s.bot, now, deltaMs)

    // ── Hit detection ────────────────────────────────────────────────────
    const distance = Math.abs(s.player.positionX - s.bot.positionX)
    let hadHit = false

    // Player hits bot
    if (isPlayerHitting(s.player, now) && distance <= HIT_RANGE && !s.player.hitConnected) {
      const hit = resolveHit(s.player, s.bot, s.player.currentMove!)
      s.bot = applyHitToDefender(s.bot, hit, s.player.currentMove!.staggerMs, now)
      s.player = applyHitToAttacker(s.player, hit)
      s.playerHitsLanded++
      s.maxCombo = Math.max(s.maxCombo, s.player.comboCount)
      lastComboHitTime.current = now
      hadHit = true

      const isKO = s.bot.hp <= 0
      hitEventsRef.current.push({
        attacker: 'player', defender: 'bot',
        damage: hit.damage, move: s.player.currentMove!,
        blocked: hit.blocked, comboCount: s.player.comboCount,
        isKO, timestamp: now,
      })

      if (isKO) {
        s.phase = 'ko'
        s.timeScale = KO_SLOWMO_SCALE
        s.slowMoUntil = now + KO_SLOWMO_MS
        koTimeRef.current = now
      } else if (!hit.blocked) {
        const moveId = s.player.currentMove!.id
        if (moveId === 'special') {
          s.timeScale = 0.1; s.slowMoUntil = now + 180
        } else if (moveId === 'heavy_attack') {
          s.timeScale = 0.15; s.slowMoUntil = now + 100
        } else if (s.player.comboCount >= 4) {
          s.timeScale = 0.3; s.slowMoUntil = now + 80
        }
      }
    }

    // Bot hits player
    if (isPlayerHitting(s.bot, now) && distance <= HIT_RANGE && !s.bot.hitConnected) {
      const hit = resolveHit(s.bot, s.player, s.bot.currentMove!)
      if (diffRef.current && hit.damage > 0) {
        hit.damage = Math.round(hit.damage * diffRef.current.damageMult)
      }
      s.player = applyHitToDefender(s.player, hit, s.bot.currentMove!.staggerMs, now)
      s.bot = applyHitToAttacker(s.bot, hit)
      s.botHitsLanded++
      hadHit = true

      const isKO = s.player.hp <= 0
      hitEventsRef.current.push({
        attacker: 'bot', defender: 'player',
        damage: hit.damage, move: s.bot.currentMove!,
        blocked: hit.blocked, comboCount: s.bot.comboCount,
        isKO, timestamp: now,
      })

      if (isKO) {
        s.phase = 'ko'
        s.timeScale = KO_SLOWMO_SCALE
        s.slowMoUntil = now + KO_SLOWMO_MS
        koTimeRef.current = now
      } else if (!hit.blocked) {
        const moveId = s.bot.currentMove!.id
        if (moveId === 'special') {
          s.timeScale = 0.1; s.slowMoUntil = now + 180
        } else if (moveId === 'heavy_attack') {
          s.timeScale = 0.15; s.slowMoUntil = now + 100
        }
      }
    }

    // Flush hits immediately for VFX, throttle HUD
    if (hadHit) {
      flushHits()
      flushHud(true) // HP changed — force immediate HUD update
    } else {
      flushHud() // throttled ~15fps
    }
  }, [input, botAI, flushHits, flushHud])

  return {
    hud, stateRef, hitEvents, startFight, tick,
    getPlayerAnim, getBotAnim, reset, emitAction, playerWon,
  }
}

function isPlayerHitting(fighter: Fighter, now: number): boolean {
  if (!fighter.currentMove) return false
  const state = fighter.state
  if (state !== 'light_attack' && state !== 'heavy_attack' && state !== 'special') return false
  const elapsed = now - fighter.stateStartedAt
  return isInActiveFrames(fighter.currentMove, elapsed)
}
