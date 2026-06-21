import type { GameLoop } from '../core/GameLoop';
import type { BattleCamera } from '../camera/BattleCamera';
import type { AnimationStateMachine } from '../animation/AnimationStateMachine';
import type { ScreenEffects } from './ScreenEffects';
import type { ParticleSystem } from './ParticleSystem';
import type { DamageEvent } from '../combat/DamageSystem';

export interface HitStopConfig {
  light: number;
  heavy: number;
  special: number;
  kill: number;
}

const DEFAULT_HITSTOP: HitStopConfig = {
  light: 0.05,
  heavy: 0.1,
  special: 0.15,
  kill: 0.4,
};

export class CombatFeel {
  private gameLoop: GameLoop;
  private camera: BattleCamera;
  private screenFx: ScreenEffects;
  private particles: ParticleSystem;
  private animMachines: Map<string, AnimationStateMachine> = new Map();

  private hitStopTimer = 0;
  private slowMoTimer = 0;
  private slowMoScale = 1;
  private hitStopConfig: HitStopConfig;

  constructor(
    gameLoop: GameLoop,
    camera: BattleCamera,
    screenFx: ScreenEffects,
    particles: ParticleSystem,
    hitStopConfig?: Partial<HitStopConfig>
  ) {
    this.gameLoop = gameLoop;
    this.camera = camera;
    this.screenFx = screenFx;
    this.particles = particles;
    this.hitStopConfig = { ...DEFAULT_HITSTOP, ...hitStopConfig };
  }

  registerAnimMachine(id: string, machine: AnimationStateMachine) {
    this.animMachines.set(id, machine);
  }

  onDamageEvent(event: DamageEvent) {
    if (event.blocked) {
      this.onBlock(event);
      return;
    }

    if (event.killed) {
      this.onKill(event);
      return;
    }

    switch (event.hitType) {
      case 'light':
        this.onLightHit(event);
        break;
      case 'heavy':
        this.onHeavyHit(event);
        break;
      case 'special':
        this.onSpecialHit(event);
        break;
    }
  }

  private onLightHit(event: DamageEvent) {
    this.hitStop(this.hitStopConfig.light);

    this.camera.shake(0.08, 35, 0.12);

    this.screenFx.onLightHit();

    this.particles.emitImpact(
      event.hitPosition,
      event.knockbackDir,
      'light'
    );
  }

  private onHeavyHit(event: DamageEvent) {
    this.hitStop(this.hitStopConfig.heavy);

    this.camera.shake(0.2, 28, 0.2);
    this.camera.punch(1.06, 0.35);

    this.screenFx.onHeavyHit();

    this.particles.emitImpact(
      event.hitPosition,
      event.knockbackDir,
      'heavy'
    );

    if (event.critical) {
      this.screenFx.onCriticalHit();
      this.camera.shake(0.35, 25, 0.3);
    }
  }

  private onSpecialHit(event: DamageEvent) {
    this.hitStop(this.hitStopConfig.special);

    this.camera.shake(0.35, 22, 0.3);
    this.camera.punch(1.1, 0.5);

    this.screenFx.onSpecialHit();

    this.particles.emitImpact(
      event.hitPosition,
      event.knockbackDir,
      'special'
    );
  }

  private onKill(event: DamageEvent) {
    const classColors: Record<string, string> = {
      berserker: '#ff4422',
      sentinel: '#4488ff',
      phantom: '#aa44ff',
    };
    const color = classColors[event.attackerId] ?? '#ffffff';

    this.hitStop(this.hitStopConfig.kill);

    this.startSlowMo(0.2, 1.5);

    this.camera.shake(0.5, 18, 0.5);
    this.camera.punch(1.15, 0.8);
    this.camera.setSlowMoFov(-8);
    setTimeout(() => this.camera.setSlowMoFov(0), 2000);

    this.screenFx.onKill(color);

    this.particles.emitKillBurst(event.hitPosition, color);
    this.particles.emitImpact(
      event.hitPosition,
      event.knockbackDir,
      'special'
    );
  }

  private onBlock(event: DamageEvent) {
    this.hitStop(0.03);

    this.camera.shake(0.05, 40, 0.08);

    this.screenFx.onBlock();

    this.particles.emitSparks(
      event.hitPosition,
      event.knockbackDir,
      0.3
    );
  }

  private hitStop(duration: number) {
    this.hitStopTimer = duration;
    this.gameLoop.timeScale = 0;

    for (const machine of this.animMachines.values()) {
      machine.pause();
    }

    setTimeout(() => {
      if (this.hitStopTimer <= 0) return;
      this.hitStopTimer = 0;
      if (this.slowMoTimer <= 0) {
        this.gameLoop.timeScale = 1;
      } else {
        this.gameLoop.timeScale = this.slowMoScale;
      }
      for (const machine of this.animMachines.values()) {
        machine.resume();
      }
    }, duration * 1000);
  }

  private startSlowMo(timeScale: number, duration: number) {
    this.slowMoScale = timeScale;
    this.slowMoTimer = duration;
    this.gameLoop.timeScale = timeScale;

    for (const machine of this.animMachines.values()) {
      machine.setTimeScale(timeScale);
    }

    setTimeout(() => {
      this.slowMoTimer = 0;
      this.slowMoScale = 1;
      this.gameLoop.timeScale = 1;
      for (const machine of this.animMachines.values()) {
        machine.setTimeScale(1);
      }
    }, duration * 1000);
  }

  update(dt: number) {
    this.screenFx.update(dt);
    this.particles.update(dt);
  }
}
