import * as THREE from 'three';
import { AnimState } from '../animation';

export interface HitboxData {
  offset: THREE.Vector3;
  radius: number;
  damage: number;
  knockback: number;
  hitStun: number;
  startFrame: number;
  endFrame: number;
  type: 'light' | 'heavy' | 'special';
}

export interface HurtboxData {
  offset: THREE.Vector3;
  radius: number;
  height: number;
}

export interface FrameData {
  startup: number;
  active: number;
  recovery: number;
  hitboxes: HitboxData[];
}

const BERSERKER_FRAME_DATA: Partial<Record<AnimState, FrameData>> = {
  [AnimState.LightAttack]: {
    startup: 3,
    active: 6,
    recovery: 6,
    hitboxes: [{
      offset: new THREE.Vector3(0, 1, 1.5),
      radius: 1.2,
      damage: 8,
      knockback: 2,
      hitStun: 0.25,
      startFrame: 3,
      endFrame: 9,
      type: 'light',
    }],
  },
  [AnimState.HeavyAttack]: {
    startup: 6,
    active: 8,
    recovery: 10,
    hitboxes: [{
      offset: new THREE.Vector3(0, 1.2, 1.8),
      radius: 1.5,
      damage: 18,
      knockback: 5,
      hitStun: 0.4,
      startFrame: 6,
      endFrame: 14,
      type: 'heavy',
    }],
  },
  [AnimState.Special]: {
    startup: 8,
    active: 10,
    recovery: 14,
    hitboxes: [
      {
        offset: new THREE.Vector3(0, 0.5, 2),
        radius: 2,
        damage: 25,
        knockback: 8,
        hitStun: 0.6,
        startFrame: 12,
        endFrame: 18,
        type: 'special',
      },
      {
        offset: new THREE.Vector3(0, 0.5, 0),
        radius: 2,
        damage: 10,
        knockback: 3,
        hitStun: 0.3,
        startFrame: 15,
        endFrame: 18,
        type: 'special',
      },
    ],
  },
};

const SENTINEL_FRAME_DATA: Partial<Record<AnimState, FrameData>> = {
  [AnimState.LightAttack]: {
    startup: 5,
    active: 3,
    recovery: 10,
    hitboxes: [{
      offset: new THREE.Vector3(0, 1.2, 1),
      radius: 0.8,
      damage: 7,
      knockback: 2.5,
      hitStun: 0.2,
      startFrame: 5,
      endFrame: 8,
      type: 'light',
    }],
  },
  [AnimState.HeavyAttack]: {
    startup: 12,
    active: 5,
    recovery: 16,
    hitboxes: [{
      offset: new THREE.Vector3(0, 1, 1.2),
      radius: 1.2,
      damage: 16,
      knockback: 6,
      hitStun: 0.45,
      startFrame: 12,
      endFrame: 17,
      type: 'heavy',
    }],
  },
  [AnimState.Special]: {
    startup: 8,
    active: 8,
    recovery: 20,
    hitboxes: [{
      offset: new THREE.Vector3(0, 1.5, 0.5),
      radius: 2,
      damage: 22,
      knockback: 7,
      hitStun: 0.5,
      startFrame: 8,
      endFrame: 16,
      type: 'special',
    }],
  },
};

const PHANTOM_FRAME_DATA: Partial<Record<AnimState, FrameData>> = {
  [AnimState.LightAttack]: {
    startup: 3,
    active: 2,
    recovery: 6,
    hitboxes: [{
      offset: new THREE.Vector3(0, 1, 0.7),
      radius: 0.6,
      damage: 6,
      knockback: 1.5,
      hitStun: 0.15,
      startFrame: 3,
      endFrame: 5,
      type: 'light',
    }],
  },
  [AnimState.HeavyAttack]: {
    startup: 8,
    active: 3,
    recovery: 12,
    hitboxes: [{
      offset: new THREE.Vector3(0, 1, 0.9),
      radius: 0.8,
      damage: 14,
      knockback: 4,
      hitStun: 0.35,
      startFrame: 8,
      endFrame: 11,
      type: 'heavy',
    }],
  },
  [AnimState.Special]: {
    startup: 6,
    active: 4,
    recovery: 14,
    hitboxes: [
      {
        offset: new THREE.Vector3(0, 1, 1),
        radius: 0.9,
        damage: 20,
        knockback: 6,
        hitStun: 0.5,
        startFrame: 6,
        endFrame: 10,
        type: 'special',
      },
    ],
  },
};

export const CLASS_FRAME_DATA: Record<string, Partial<Record<AnimState, FrameData>>> = {
  berserker: BERSERKER_FRAME_DATA,
  sentinel: SENTINEL_FRAME_DATA,
  phantom: PHANTOM_FRAME_DATA,
};

const DEFAULT_HURTBOX: HurtboxData = {
  offset: new THREE.Vector3(0, 0.9, 0),
  radius: 0.5,
  height: 1.8,
};

export interface HitResult {
  hit: boolean;
  hitbox: HitboxData | null;
  distance: number;
}

export class HitboxSystem {
  private frameCounter = 0;
  private activeHitboxes: Map<string, { hitbox: HitboxData; worldPos: THREE.Vector3 }[]> = new Map();
  private hitLog: Set<string> = new Set();

  resetForAttack(attackerId: string) {
    this.frameCounter = 0;
    this.activeHitboxes.delete(attackerId);
    this.hitLog.clear();
  }

  advanceFrame() {
    this.frameCounter++;
  }

  updateAttackerHitboxes(
    attackerId: string,
    attackerPos: THREE.Vector3,
    attackerRotation: number,
    frameData: FrameData
  ) {
    const active: { hitbox: HitboxData; worldPos: THREE.Vector3 }[] = [];

    for (const hb of frameData.hitboxes) {
      if (this.frameCounter >= hb.startFrame && this.frameCounter <= hb.endFrame) {
        const rotatedOffset = hb.offset.clone().applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          attackerRotation
        );
        const worldPos = attackerPos.clone().add(rotatedOffset);
        active.push({ hitbox: hb, worldPos });
      }
    }

    this.activeHitboxes.set(attackerId, active);
  }

  checkHit(
    attackerId: string,
    defenderId: string,
    defenderPos: THREE.Vector3,
    hurtbox: HurtboxData = DEFAULT_HURTBOX
  ): HitResult {
    const hitKey = `${attackerId}_${defenderId}_${this.frameCounter}`;
    if (this.hitLog.has(hitKey)) {
      return { hit: false, hitbox: null, distance: Infinity };
    }

    const hitboxes = this.activeHitboxes.get(attackerId);
    if (!hitboxes || hitboxes.length === 0) {
      return { hit: false, hitbox: null, distance: Infinity };
    }

    const hurtCenter = defenderPos.clone().add(hurtbox.offset);

    for (const { hitbox, worldPos } of hitboxes) {
      const dx = worldPos.x - hurtCenter.x;
      const dz = worldPos.z - hurtCenter.z;
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);

      const verticalDist = Math.abs(worldPos.y - hurtCenter.y);

      if (
        horizontalDist < hitbox.radius + hurtbox.radius &&
        verticalDist < hurtbox.height * 0.5 + hitbox.radius
      ) {
        this.hitLog.add(hitKey);
        return { hit: true, hitbox, distance: horizontalDist };
      }
    }

    return { hit: false, hitbox: null, distance: Infinity };
  }

  get currentFrame(): number {
    return this.frameCounter;
  }

  isInStartup(frameData: FrameData): boolean {
    return this.frameCounter < frameData.startup;
  }

  isInActive(frameData: FrameData): boolean {
    return (
      this.frameCounter >= frameData.startup &&
      this.frameCounter < frameData.startup + frameData.active
    );
  }

  isInRecovery(frameData: FrameData): boolean {
    return (
      this.frameCounter >= frameData.startup + frameData.active &&
      this.frameCounter < frameData.startup + frameData.active + frameData.recovery
    );
  }
}
