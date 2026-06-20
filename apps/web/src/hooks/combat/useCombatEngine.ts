'use client'

import { useState, useRef, useCallback } from 'react'
import type { CombatState, HitEvent, Fighter } from '@/lib/combat/types'
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

interface CombatEngineResult {
  state: CombatState
  /** Queued hit events for VFX/audio (consumed each frame) */
  hitEvents: HitEvent[]
  /** Start a new fight */
  startFight: (playerClass: CharacterClass, botClass: CharacterClass, rank: string) => void
  /** Called every frame from useFrame — drives the entire combat loop */
  tick: (deltaMs: number) => void
  /** Get animation state for rendering */
  getPlayerAnim: () => { clip: string; speed: number }
  getBotAnim: () => { clip: string; speed: number }
  /** Reset to idle */
  reset: () => void
  /** Manually emit a combat action (for on-screen buttons) */
  emitAction: (action: import('@/lib/combat/types').CombatAction) => void
  /** Whether the player won */
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

export function useCombatEngine(rank: string): CombatEngineResult {
  const [state, setState] = useState<CombatState>(createInitialState)
  const stateRef = useRef<CombatState>(state)
  const hitEventsRef = useRef<HitEvent[]>([])
  const [hitEvents, setHitEvents] = useState<HitEvent[]>([])
  const introStartRef = useRef(0)
  const koTimeRef = useRef(0)
  const lastComboHitTime = useRef(0)

  const input = useInputSystem(stateRef.current.phase === 'fighting')
  const botAI = useBotAI(rank)

  const flush = useCallback(() => {
    setState({ ...stateRef.current })
    setHitEvents([...hitEventsRef.current])
    hitEventsRef.current = []
  }, [])

  const startFight = useCallback((
    playerClass: CharacterClass,
    botClass: CharacterClass,
    _playerRank: string,
  ) => {
    const s = createInitialState()
    s.player = createFighter('player', playerClass)
    s.bot = createFighter('bot', botClass)
    s.phase = 'intro'
    introStartRef.current = performance.now()
    koTimeRef.current = 0
    lastComboHitTime.current = 0
    stateRef.current = s
    botAI.init(botClass)
    flush()
  }, [botAI, flush])

  const emitAction = useCallback((action: import('@/lib/combat/types').CombatAction) => {
    input.emit(action)
  }, [input])

  const reset = useCallback(() => {
    stateRef.current = createInitialState()
    flush()
  }, [flush])

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
      }
      stateRef.current = s
      flush()
      return
    }

    // ── KO phase — wait then go to result ────────────────────────────────
    if (s.phase === 'ko') {
      if (now - koTimeRef.current >= KO_TO_RESULT_DELAY_MS) {
        s.phase = 'result'
        s.timeScale = 1.0
      }
      stateRef.current = s
      flush()
      return
    }

    if (s.phase !== 'fighting') {
      flush()
      return
    }

    // ── Time scaling (slow-mo) ───────────────────────────────────────────
    if (now >= s.slowMoUntil) s.timeScale = 1.0
    const deltaMs = rawDeltaMs * s.timeScale
    s.elapsedMs += deltaMs

    // ── Time limit ───────────────────────────────────────────────────────
    if (s.elapsedMs >= FIGHT_TIME_LIMIT_MS) {
      s.phase = 'ko'
      koTimeRef.current = now
      if (s.player.hp <= s.bot.hp && s.player.state !== 'dead') {
        s.player.state = 'dead'
        s.player.stateStartedAt = now
      }
      if (s.bot.hp <= s.player.hp && s.bot.state !== 'dead') {
        s.bot.state = 'dead'
        s.bot.stateStartedAt = now
      }
      stateRef.current = s
      flush()
      return
    }

    // ── Combo drop ───────────────────────────────────────────────────────
    if (s.player.comboCount > 0 && now - lastComboHitTime.current > COMBO_DROP_MS) {
      s.player.comboCount = 0
    }
    if (s.bot.comboCount > 0) {
      // Bot combo resets handled similarly but bot has no explicit timer concern
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

    // Player hits bot
    if (isPlayerHitting(s.player, now) && distance <= HIT_RANGE && !s.player.hitConnected) {
      const hit = resolveHit(s.player, s.bot, s.player.currentMove!)
      s.bot = applyHitToDefender(s.bot, hit, s.player.currentMove!.staggerMs, now)
      s.player = applyHitToAttacker(s.player, hit)
      s.playerHitsLanded++
      s.maxCombo = Math.max(s.maxCombo, s.player.comboCount)
      lastComboHitTime.current = now

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
      }
    }

    // Bot hits player
    if (isPlayerHitting(s.bot, now) && distance <= HIT_RANGE && !s.bot.hitConnected) {
      const hit = resolveHit(s.bot, s.player, s.bot.currentMove!)
      s.player = applyHitToDefender(s.player, hit, s.bot.currentMove!.staggerMs, now)
      s.bot = applyHitToAttacker(s.bot, hit)
      s.botHitsLanded++

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
      }
    }

    stateRef.current = s
    flush()
  }, [input, botAI, flush])

  return {
    state, hitEvents, startFight, tick,
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
