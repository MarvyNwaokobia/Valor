import * as THREE from 'three';
import { Action, type InputSystem } from '../input/InputSystem';

export interface CharacterState {
  position: THREE.Vector3;
  rotation: number;
  velocity: THREE.Vector3;
  isGrounded: boolean;
  isAttacking: boolean;
  isBlocking: boolean;
  isDodging: boolean;
  isStaggered: boolean;
  isDead: boolean;
  facingRight: boolean;
  health: number;
  maxHealth: number;
  specialMeter: number;
  comboCount: number;
}

export interface CharacterConfig {
  moveSpeed: number;
  runSpeed: number;
  dodgeSpeed: number;
  dodgeDuration: number;
  dodgeCooldown: number;
  turnSpeed: number;
  gravity: number;
  arenaRadius: number;
  arenaMinX: number;
  arenaMaxX: number;
  arenaMinZ: number;
  arenaMaxZ: number;
}

const DEFAULT_CONFIG: CharacterConfig = {
  moveSpeed: 3.5,
  runSpeed: 6,
  dodgeSpeed: 10,
  dodgeDuration: 0.3,
  dodgeCooldown: 0.8,
  turnSpeed: 10,
  gravity: -20,
  arenaRadius: 12,
  arenaMinX: -12,
  arenaMaxX: 12,
  arenaMinZ: -8,
  arenaMaxZ: 8,
};

export class CharacterController {
  state: CharacterState;
  config: CharacterConfig;

  private dodgeTimer = 0;
  private dodgeCooldownTimer = 0;
  private dodgeDirection = new THREE.Vector3();
  private targetRotation = 0;
  private lockOnTarget: CharacterController | null = null;

  constructor(
    startPosition: THREE.Vector3,
    config?: Partial<CharacterConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      position: startPosition.clone(),
      rotation: 0,
      velocity: new THREE.Vector3(),
      isGrounded: true,
      isAttacking: false,
      isBlocking: false,
      isDodging: false,
      isStaggered: false,
      isDead: false,
      facingRight: true,
      health: 100,
      maxHealth: 100,
      specialMeter: 0,
      comboCount: 0,
    };
  }

  setLockOnTarget(target: CharacterController | null) {
    this.lockOnTarget = target;
  }

  update(dt: number, input: InputSystem, cameraYaw: number) {
    if (this.state.isDead) return;

    this.updateTimers(dt);

    if (this.state.isAttacking) {
      // Apply lunge momentum during attacks
      this.state.position.addScaledVector(this.state.velocity, dt);
      const decay = Math.exp(-10 * dt);
      this.state.velocity.x *= decay;
      this.state.velocity.z *= decay;
      // Face lock-on target during attacks
      if (this.lockOnTarget) {
        const toTarget = new THREE.Vector3()
          .subVectors(this.lockOnTarget.state.position, this.state.position)
          .setY(0);
        this.targetRotation = Math.atan2(toTarget.x, toTarget.z);
        this.state.rotation = lerpAngle(this.state.rotation, this.targetRotation, this.config.turnSpeed * dt);
      }
      this.clampToArena();
      return;
    }

    if (this.state.isStaggered) return;

    if (this.state.isDodging) {
      this.applyDodgeMovement(dt);
    } else {
      this.handleMovement(dt, input, cameraYaw);
      this.handleActions(input);
    }

    this.applyGravity(dt);
    this.clampToArena();
  }

  applyDamage(amount: number, knockbackDir: THREE.Vector3, knockbackForce: number) {
    if (this.state.isDodging) return;

    const blocked = this.state.isBlocking;
    const actualDamage = blocked ? Math.floor(amount * 0.25) : amount;

    this.state.health = Math.max(0, this.state.health - actualDamage);

    if (!blocked) {
      this.state.velocity.addScaledVector(knockbackDir, knockbackForce);
      this.state.isStaggered = true;
      this.state.isAttacking = false;
      this.state.comboCount = 0;
    }

    if (this.state.health <= 0) {
      this.state.isDead = true;
      this.state.isAttacking = false;
      this.state.isBlocking = false;
      this.state.isStaggered = false;
    }

    return { blocked, actualDamage };
  }

  clearStagger() {
    this.state.isStaggered = false;
  }

  private updateTimers(dt: number) {
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      if (this.dodgeTimer <= 0) {
        this.state.isDodging = false;
      }
    }
    if (this.dodgeCooldownTimer > 0) {
      this.dodgeCooldownTimer -= dt;
    }
  }

  private handleMovement(dt: number, input: InputSystem, cameraYaw: number) {
    const move = input.moveAxis;
    const hasInput = Math.abs(move.x) > 0.1 || Math.abs(move.y) > 0.1;

    if (!hasInput) {
      const decay = Math.exp(-15 * dt);
      this.state.velocity.x *= decay;
      this.state.velocity.z *= decay;
      if (Math.abs(this.state.velocity.x) < 0.01) this.state.velocity.x = 0;
      if (Math.abs(this.state.velocity.z) < 0.01) this.state.velocity.z = 0;
      return;
    }

    const forward = new THREE.Vector3(
      -Math.sin(cameraYaw),
      0,
      -Math.cos(cameraYaw)
    );
    const right = new THREE.Vector3(
      Math.cos(cameraYaw),
      0,
      -Math.sin(cameraYaw)
    );

    const moveDir = new THREE.Vector3()
      .addScaledVector(right, move.x)
      .addScaledVector(forward, move.y)
      .normalize();

    const speed = this.config.moveSpeed;
    this.state.velocity.x = moveDir.x * speed;
    this.state.velocity.z = moveDir.z * speed;

    if (this.lockOnTarget) {
      const toTarget = new THREE.Vector3()
        .subVectors(this.lockOnTarget.state.position, this.state.position)
        .setY(0);
      this.targetRotation = Math.atan2(toTarget.x, toTarget.z);
    } else {
      this.targetRotation = Math.atan2(moveDir.x, moveDir.z);
    }

    this.state.rotation = lerpAngle(
      this.state.rotation,
      this.targetRotation,
      this.config.turnSpeed * dt
    );

    this.state.position.addScaledVector(this.state.velocity, dt);
    this.state.facingRight = Math.sin(this.state.rotation) > 0;
  }

  private handleActions(input: InputSystem) {
    const dodge = input.getAction(Action.Dodge);
    if (dodge.justPressed && this.dodgeCooldownTimer <= 0) {
      this.startDodge();
    }

    this.state.isBlocking = input.getAction(Action.Block).held;
  }

  private startDodge() {
    this.state.isDodging = true;
    this.dodgeTimer = this.config.dodgeDuration;
    this.dodgeCooldownTimer = this.config.dodgeCooldown;

    const forward = new THREE.Vector3(
      Math.sin(this.state.rotation),
      0,
      Math.cos(this.state.rotation)
    );

    if (this.state.velocity.lengthSq() > 0.1) {
      this.dodgeDirection.copy(this.state.velocity).normalize();
    } else {
      this.dodgeDirection.copy(forward);
    }
  }

  private applyDodgeMovement(dt: number) {
    this.state.position.addScaledVector(
      this.dodgeDirection,
      this.config.dodgeSpeed * dt
    );
  }

  private applyGravity(dt: number) {
    if (!this.state.isGrounded) {
      this.state.velocity.y += this.config.gravity * dt;
      this.state.position.y += this.state.velocity.y * dt;
    }

    if (this.state.position.y <= 0) {
      this.state.position.y = 0;
      this.state.velocity.y = 0;
      this.state.isGrounded = true;
    }
  }

  private clampToArena() {
    const p = this.state.position;
    p.x = Math.max(this.config.arenaMinX, Math.min(this.config.arenaMaxX, p.x));
    p.z = Math.max(this.config.arenaMinZ, Math.min(this.config.arenaMaxZ, p.z));
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * Math.min(t, 1);
}
