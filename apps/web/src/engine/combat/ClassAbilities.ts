import * as THREE from 'three';
import type { CharacterController } from '../character';
import type { FighterStats } from './DamageSystem';

export interface AbilityState {
  active: boolean;
  timer: number;
  cooldownTimer: number;
}

export interface ClassAbility {
  name: string;
  duration: number;
  cooldown: number;
  activate: (
    fighter: CharacterController,
    stats: FighterStats,
    target?: CharacterController
  ) => void;
  deactivate: (
    fighter: CharacterController,
    stats: FighterStats
  ) => void;
  tick?: (
    dt: number,
    fighter: CharacterController,
    stats: FighterStats,
    target?: CharacterController
  ) => void;
}

// Berserker — RAGE MODE
// Below 40% HP: attack +50%, defense -20%, move speed +30%
// Stacks with low HP: gets more dangerous as health drops
const berserkerRage: ClassAbility = {
  name: 'Berserker Rage',
  duration: 8,
  cooldown: 15,
  activate(fighter, stats) {
    const hpRatio = fighter.state.health / fighter.state.maxHealth;
    const rageMult = hpRatio < 0.2 ? 1.8 : hpRatio < 0.4 ? 1.5 : 1.3;
    stats.attack *= rageMult;
    stats.defense *= 0.8;
    fighter.config.moveSpeed *= 1.3;
    fighter.config.runSpeed *= 1.3;
  },
  deactivate(fighter, stats) {
    const hpRatio = fighter.state.health / fighter.state.maxHealth;
    const rageMult = hpRatio < 0.2 ? 1.8 : hpRatio < 0.4 ? 1.5 : 1.3;
    stats.attack /= rageMult;
    stats.defense /= 0.8;
    fighter.config.moveSpeed /= 1.3;
    fighter.config.runSpeed /= 1.3;
  },
};

// Sentinel — PERFECT PARRY
// Timed block within 6 frames of attack landing reflects 150% damage
// Successful parry stuns attacker and opens a free counter window
const sentinelParry: ClassAbility = {
  name: 'Perfect Parry',
  duration: 0.1,
  cooldown: 1.5,
  activate(fighter, stats) {
    stats.blockEfficiency = 1.0;
    (fighter as any).__parryWindow = true;
  },
  deactivate(fighter, stats) {
    stats.blockEfficiency = 0.85;
    (fighter as any).__parryWindow = false;
  },
};

// Phantom — SHADOW STEP
// Teleport behind the target, gain brief invincibility, next attack
// deals 2x damage (backstab bonus)
const phantomShadowStep: ClassAbility = {
  name: 'Shadow Step',
  duration: 0.8,
  cooldown: 5,
  activate(fighter, stats, target) {
    if (!target) return;

    const behind = new THREE.Vector3(
      Math.sin(target.state.rotation),
      0,
      Math.cos(target.state.rotation)
    ).multiplyScalar(-1.5);

    fighter.state.position.copy(target.state.position).add(behind);

    const toTarget = new THREE.Vector3()
      .subVectors(target.state.position, fighter.state.position)
      .setY(0);
    fighter.state.rotation = Math.atan2(toTarget.x, toTarget.z);

    fighter.state.isDodging = true;
    stats.attack *= 2;

    setTimeout(() => {
      fighter.state.isDodging = false;
    }, 200);
  },
  deactivate(_fighter, stats) {
    stats.attack /= 2;
  },
};

export const CLASS_ABILITIES: Record<string, ClassAbility> = {
  berserker: berserkerRage,
  sentinel: sentinelParry,
  phantom: phantomShadowStep,
};

export class AbilityManager {
  private states: Map<string, AbilityState> = new Map();
  private abilities: Map<string, ClassAbility> = new Map();

  register(fighterId: string, classId: string) {
    const ability = CLASS_ABILITIES[classId];
    if (!ability) return;
    this.abilities.set(fighterId, ability);
    this.states.set(fighterId, {
      active: false,
      timer: 0,
      cooldownTimer: 0,
    });
  }

  canActivate(fighterId: string): boolean {
    const state = this.states.get(fighterId);
    return state ? !state.active && state.cooldownTimer <= 0 : false;
  }

  activate(
    fighterId: string,
    fighter: CharacterController,
    stats: FighterStats,
    target?: CharacterController
  ): boolean {
    const ability = this.abilities.get(fighterId);
    const state = this.states.get(fighterId);
    if (!ability || !state || !this.canActivate(fighterId)) return false;

    ability.activate(fighter, stats, target);
    state.active = true;
    state.timer = ability.duration;
    return true;
  }

  update(
    dt: number,
    fighterId: string,
    fighter: CharacterController,
    stats: FighterStats,
    target?: CharacterController
  ) {
    const ability = this.abilities.get(fighterId);
    const state = this.states.get(fighterId);
    if (!ability || !state) return;

    if (state.cooldownTimer > 0) {
      state.cooldownTimer -= dt;
    }

    if (state.active) {
      state.timer -= dt;
      ability.tick?.(dt, fighter, stats, target);

      if (state.timer <= 0) {
        ability.deactivate(fighter, stats);
        state.active = false;
        state.cooldownTimer = ability.cooldown;
      }
    }
  }

  getState(fighterId: string): AbilityState | undefined {
    return this.states.get(fighterId);
  }

  getAbility(fighterId: string): ClassAbility | undefined {
    return this.abilities.get(fighterId);
  }

  isParryWindow(fighterId: string): boolean {
    const state = this.states.get(fighterId);
    return state?.active === true && this.abilities.get(fighterId)?.name === 'Perfect Parry';
  }
}
