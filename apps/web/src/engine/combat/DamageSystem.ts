import * as THREE from 'three';
import type { CharacterController } from '../character';
import type { HitboxData } from './HitboxSystem';
import type { MoveDefinition } from './MoveRegistry';

export interface DamageEvent {
  attackerId: string;
  defenderId: string;
  rawDamage: number;
  finalDamage: number;
  blocked: boolean;
  critical: boolean;
  hitType: 'light' | 'heavy' | 'special';
  knockbackDir: THREE.Vector3;
  knockbackForce: number;
  hitStun: number;
  hitPosition: THREE.Vector3;
  killed: boolean;
}

export type DamageListener = (event: DamageEvent) => void;

export interface FighterStats {
  attack: number;
  defense: number;
  critRate: number;
  critMultiplier: number;
  blockEfficiency: number;
  staminaMax: number;
  stamina: number;
  staminaRegen: number;
}

const CLASS_BASE_STATS: Record<string, FighterStats> = {
  berserker: {
    attack: 1.3,
    defense: 0.9,
    critRate: 0.15,
    critMultiplier: 1.8,
    blockEfficiency: 0.6,
    staminaMax: 100,
    stamina: 100,
    staminaRegen: 8,
  },
  sentinel: {
    attack: 1.0,
    defense: 1.4,
    critRate: 0.08,
    critMultiplier: 1.5,
    blockEfficiency: 0.85,
    staminaMax: 120,
    stamina: 120,
    staminaRegen: 6,
  },
  phantom: {
    attack: 1.1,
    defense: 0.8,
    critRate: 0.25,
    critMultiplier: 2.0,
    blockEfficiency: 0.5,
    staminaMax: 80,
    stamina: 80,
    staminaRegen: 12,
  },
};

export function getBaseStats(classId: string): FighterStats {
  return { ...(CLASS_BASE_STATS[classId] ?? CLASS_BASE_STATS.berserker) };
}

export class DamageSystem {
  private listeners: DamageListener[] = [];
  private stats: Map<string, FighterStats> = new Map();

  registerFighter(id: string, classId: string) {
    this.stats.set(id, getBaseStats(classId));
  }

  getStats(id: string): FighterStats | undefined {
    return this.stats.get(id);
  }

  onDamage(listener: DamageListener) {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  calculateAndApply(
    attackerId: string,
    defenderId: string,
    attacker: CharacterController,
    defender: CharacterController,
    hitbox: HitboxData,
    move: MoveDefinition,
    contactPoint?: THREE.Vector3
  ): DamageEvent {
    const atkStats = this.stats.get(attackerId);
    const defStats = this.stats.get(defenderId);
    if (!atkStats || !defStats) {
      throw new Error(`Fighter stats not found: ${attackerId} or ${defenderId}`);
    }

    const critical = Math.random() < atkStats.critRate;
    const critMult = critical ? atkStats.critMultiplier : 1;

    const rawDamage = Math.round(hitbox.damage * atkStats.attack * critMult);

    const blocked = defender.state.isBlocking && move.blockable;
    const defenseReduction = blocked
      ? defStats.blockEfficiency
      : defStats.defense * 0.1;
    const finalDamage = Math.max(1, Math.round(rawDamage * (1 - defenseReduction)));

    if (blocked && defStats.stamina !== undefined) {
      defStats.stamina = Math.max(0, defStats.stamina - rawDamage * 0.5);
    }

    const knockbackDir = new THREE.Vector3()
      .subVectors(defender.state.position, attacker.state.position)
      .setY(0)
      .normalize();

    const knockbackForce = blocked
      ? hitbox.knockback * 0.3
      : hitbox.knockback;

    const hitStun = blocked ? hitbox.hitStun * 0.4 : hitbox.hitStun;

    // Prefer the true contact point (the fist/weapon position); fall back to a
    // point just in front of the defender's torso if none was supplied.
    const hitPosition = contactPoint
      ? contactPoint.clone()
      : defender.state.position.clone().setY(defender.state.position.y + 1).addScaledVector(knockbackDir, -0.3);

    const result = defender.applyDamage(finalDamage, knockbackDir, knockbackForce);

    const event: DamageEvent = {
      attackerId,
      defenderId,
      rawDamage,
      finalDamage: result?.actualDamage ?? finalDamage,
      blocked: result?.blocked ?? blocked,
      critical,
      hitType: hitbox.type,
      knockbackDir,
      knockbackForce,
      hitStun,
      hitPosition,
      killed: defender.state.isDead,
    };

    for (const listener of this.listeners) {
      listener(event);
    }

    return event;
  }

  updateStamina(dt: number) {
    for (const stats of this.stats.values()) {
      stats.stamina = Math.min(
        stats.staminaMax,
        stats.stamina + stats.staminaRegen * dt
      );
    }
  }

  consumeStamina(id: string, amount: number): boolean {
    const stats = this.stats.get(id);
    if (!stats) return false;
    if (stats.stamina < amount) return false;
    stats.stamina -= amount;
    return true;
  }

  hasStamina(id: string, amount: number): boolean {
    const stats = this.stats.get(id);
    return stats ? stats.stamina >= amount : false;
  }
}
