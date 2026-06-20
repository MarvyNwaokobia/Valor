import { useRef, useCallback } from 'react'
import type { Fighter, CombatAction, BotPersonality, BotAIConfig } from '@/lib/combat/types'
import { BOT_ACTION_COOLDOWN_MS, BOT_REACTION_RANGE } from '@/lib/combat/constants'
import { SPECIAL_METER_THRESHOLD } from '@/lib/combat/constants'

function personalityConfig(personality: BotPersonality, rank: string): BotAIConfig {
  const [rMin, rMax] = BOT_REACTION_RANGE[rank] ?? BOT_REACTION_RANGE.Bronze

  switch (personality) {
    case 'aggressive':
      return {
        personality, aggression: 0.75, blockRate: 0.1, dodgeRate: 0.1, damageMult: 1.0,
        reactionMs: rMin + (rMax - rMin) * 0.3,
      }
    case 'defensive':
      return {
        personality, aggression: 0.3, blockRate: 0.45, dodgeRate: 0.2, damageMult: 0.9,
        reactionMs: rMin + (rMax - rMin) * 0.5,
      }
    case 'adaptive':
      return {
        personality, aggression: 0.5, blockRate: 0.25, dodgeRate: 0.15, damageMult: 1.0,
        reactionMs: rMin + (rMax - rMin) * 0.4,
      }
    case 'balanced':
    default:
      return {
        personality, aggression: 0.5, blockRate: 0.2, dodgeRate: 0.12, damageMult: 0.95,
        reactionMs: rMin + (rMax - rMin) * 0.5,
      }
  }
}

function pickPersonalityForClass(cls: string): BotPersonality {
  switch (cls) {
    case 'Berserker': return 'aggressive'
    case 'Sentinel':  return 'defensive'
    case 'Phantom':   return 'adaptive'
    default:          return 'balanced'
  }
}

export function useBotAI(rank: string) {
  const lastActionTime = useRef(0)
  const nextActionDelay = useRef(0)
  const config = useRef<BotAIConfig | null>(null)

  const init = useCallback((botClass: string) => {
    const personality = pickPersonalityForClass(botClass)
    config.current = personalityConfig(personality, rank)
    lastActionTime.current = 0
    nextActionDelay.current = config.current.reactionMs
  }, [rank])

  const decide = useCallback((
    bot: Fighter,
    player: Fighter,
    now: number,
  ): CombatAction | null => {
    const cfg = config.current
    if (!cfg) return null
    if (bot.state === 'dead' || bot.state === 'hit_stun') return null

    // Cooldown between actions
    if (now - lastActionTime.current < nextActionDelay.current) return null

    const canAct = bot.state === 'idle' || bot.state === 'blocking'
    if (!canAct) return null

    const distance = Math.abs(player.positionX - bot.positionX)
    const playerAttacking = player.state === 'light_attack' || player.state === 'heavy_attack' || player.state === 'special'
    const botLowHp = bot.hp < 30
    const playerLowHp = player.hp < 25
    const roll = Math.random()

    let action: CombatAction | null = null

    // Adaptive: shift aggression based on HP difference
    let aggression = cfg.aggression
    if (cfg.personality === 'adaptive') {
      if (bot.hp > player.hp + 20) aggression = 0.7
      else if (bot.hp < player.hp - 20) aggression = 0.35
    }

    // React to player attacking: block or dodge
    if (playerAttacking && distance < 2.0) {
      if (roll < cfg.dodgeRate && bot.stamina >= 20) {
        action = 'dodge'
      } else if (roll < cfg.dodgeRate + cfg.blockRate) {
        action = bot.state === 'blocking' ? null : 'block_start'
      }
    }

    // Use special when meter is full
    if (!action && !bot.specialUsed && bot.specialMeter >= SPECIAL_METER_THRESHOLD && distance < 1.8) {
      if (roll < 0.7) action = 'special'
    }

    // Aggressive: go for the kill when player is low
    if (!action && playerLowHp && distance < 1.8) {
      action = roll < 0.6 ? 'heavy_attack' : 'light_attack'
    }

    // Release block when player isn't attacking
    if (!action && bot.state === 'blocking' && !playerAttacking) {
      action = 'block_end'
    }

    // Default offensive decision
    if (!action && distance < 1.8) {
      if (roll < aggression * 0.6) {
        action = 'light_attack'
      } else if (roll < aggression * 0.8) {
        action = 'heavy_attack'
      } else if (roll < aggression * 0.8 + cfg.blockRate && bot.state !== 'blocking') {
        action = 'block_start'
      }
    }

    // Defensive when low HP
    if (!action && botLowHp && bot.state !== 'blocking') {
      if (roll < 0.35) action = 'block_start'
      else if (roll < 0.5 && bot.stamina >= 20) action = 'dodge'
    }

    if (action) {
      lastActionTime.current = now
      // Vary timing so bot doesn't feel robotic
      const variance = 0.6 + Math.random() * 0.8
      nextActionDelay.current = BOT_ACTION_COOLDOWN_MS * variance + cfg.reactionMs * (0.5 + Math.random() * 0.5)
    }

    return action
  }, [])

  return { init, decide }
}
