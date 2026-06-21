import * as THREE from 'three';
import { Action, InputSystem } from '../input';
import type { CharacterController } from '../character';

export enum AIState {
  Idle = 'idle',
  Approach = 'approach',
  Circle = 'circle',
  Telegraph = 'telegraph',
  Attack = 'attack',
  Recovery = 'recovery',
  Block = 'block',
  Retreat = 'retreat',
  Staggered = 'staggered',
}

export enum AIDifficulty {
  Easy = 'easy',
  Medium = 'medium',
  Hard = 'hard',
  Boss = 'boss',
}

interface AIConfig {
  attackRange: number;
  circleRange: number;
  retreatRange: number;
  reactionTime: number;
  aggressiveness: number;
  blockChance: number;
  dodgeChance: number;
  comboChance: number;
  telegraphDuration: number;
  recoveryDuration: number;
  idleDuration: [number, number];
  circleDuration: [number, number];
}

const DIFFICULTY_CONFIGS: Record<AIDifficulty, AIConfig> = {
  [AIDifficulty.Easy]: {
    attackRange: 2.5,
    circleRange: 4,
    retreatRange: 1.5,
    reactionTime: 0.6,
    aggressiveness: 0.3,
    blockChance: 0.15,
    dodgeChance: 0.05,
    comboChance: 0.1,
    telegraphDuration: 0.8,
    recoveryDuration: 1.2,
    idleDuration: [1.5, 3],
    circleDuration: [2, 4],
  },
  [AIDifficulty.Medium]: {
    attackRange: 2.5,
    circleRange: 3.5,
    retreatRange: 1.2,
    reactionTime: 0.3,
    aggressiveness: 0.65,
    blockChance: 0.3,
    dodgeChance: 0.15,
    comboChance: 0.3,
    telegraphDuration: 0.3,
    recoveryDuration: 0.6,
    idleDuration: [0.5, 1],
    circleDuration: [1, 2],
  },
  [AIDifficulty.Hard]: {
    attackRange: 3,
    circleRange: 3,
    retreatRange: 1,
    reactionTime: 0.15,
    aggressiveness: 0.7,
    blockChance: 0.55,
    dodgeChance: 0.35,
    comboChance: 0.6,
    telegraphDuration: 0.3,
    recoveryDuration: 0.5,
    idleDuration: [0.5, 1.5],
    circleDuration: [1, 2],
  },
  [AIDifficulty.Boss]: {
    attackRange: 3.5,
    circleRange: 3,
    retreatRange: 0.8,
    reactionTime: 0.08,
    aggressiveness: 0.85,
    blockChance: 0.7,
    dodgeChance: 0.5,
    comboChance: 0.8,
    telegraphDuration: 0.4,
    recoveryDuration: 0.4,
    idleDuration: [0.3, 1],
    circleDuration: [0.5, 1.5],
  },
};

export class EnemyAI {
  private state: AIState = AIState.Idle;
  private config: AIConfig;
  private stateTimer = 0;
  private circleDirection = 1;
  private pendingAttack: Action | null = null;
  private virtualInput: InputSystem;

  constructor(difficulty: AIDifficulty = AIDifficulty.Medium) {
    this.config = { ...DIFFICULTY_CONFIGS[difficulty] };
    this.virtualInput = new InputSystem();
  }

  getInput(): InputSystem {
    return this.virtualInput;
  }

  update(
    dt: number,
    self: CharacterController,
    player: CharacterController
  ) {
    if (self.state.isDead) return;
    if (self.state.isStaggered) {
      this.state = AIState.Staggered;
      this.stateTimer = 0.3;
    }

    this.stateTimer -= dt;
    this.clearInput();

    const toPlayer = new THREE.Vector3()
      .subVectors(player.state.position, self.state.position)
      .setY(0);
    const distance = toPlayer.length();
    const dirToPlayer = toPlayer.clone().normalize();

    switch (this.state) {
      case AIState.Idle:
        this.handleIdle(distance);
        break;
      case AIState.Approach:
        this.handleApproach(distance, dirToPlayer);
        break;
      case AIState.Circle:
        this.handleCircle(dt, distance, dirToPlayer);
        break;
      case AIState.Telegraph:
        this.handleTelegraph();
        break;
      case AIState.Attack:
        this.handleAttack();
        break;
      case AIState.Recovery:
        this.handleRecovery(distance);
        break;
      case AIState.Block:
        this.handleBlock(distance);
        break;
      case AIState.Retreat:
        this.handleRetreat(distance, dirToPlayer);
        break;
      case AIState.Staggered:
        this.handleStaggered();
        break;
    }

    if (
      this.state !== AIState.Staggered &&
      this.state !== AIState.Block &&
      player.state.isAttacking &&
      distance < this.config.attackRange * 1.2
    ) {
      this.tryDefend();
    }
  }

  get currentState(): AIState {
    return this.state;
  }

  private clearInput() {
    this.virtualInput.releaseAction(Action.MoveForward);
    this.virtualInput.releaseAction(Action.MoveBack);
    this.virtualInput.releaseAction(Action.MoveLeft);
    this.virtualInput.releaseAction(Action.MoveRight);
    this.virtualInput.releaseAction(Action.LightAttack);
    this.virtualInput.releaseAction(Action.HeavyAttack);
    this.virtualInput.releaseAction(Action.Special);
    this.virtualInput.releaseAction(Action.Block);
    this.virtualInput.releaseAction(Action.Dodge);
  }

  private handleIdle(distance: number) {
    if (this.stateTimer <= 0) {
      if (distance > this.config.circleRange) {
        this.transition(AIState.Approach);
      } else if (distance < this.config.attackRange && Math.random() < this.config.aggressiveness) {
        this.transition(AIState.Telegraph);
      } else {
        this.transition(AIState.Circle);
      }
    }
  }

  private handleApproach(distance: number, dir: THREE.Vector3) {
    if (distance <= this.config.attackRange) {
      if (Math.random() < this.config.aggressiveness) {
        this.transition(AIState.Telegraph);
      } else {
        this.transition(AIState.Circle);
      }
      return;
    }

    if (dir.z < 0) this.virtualInput.triggerAction(Action.MoveForward);
    if (dir.z > 0) this.virtualInput.triggerAction(Action.MoveBack);
    if (dir.x > 0) this.virtualInput.triggerAction(Action.MoveRight);
    if (dir.x < 0) this.virtualInput.triggerAction(Action.MoveLeft);
  }

  private handleCircle(dt: number, distance: number, dir: THREE.Vector3) {
    if (this.stateTimer <= 0) {
      if (Math.random() < this.config.aggressiveness) {
        this.transition(AIState.Telegraph);
      } else {
        this.transition(AIState.Idle);
      }
      return;
    }

    const perpX = -dir.z * this.circleDirection;
    const perpZ = dir.x * this.circleDirection;

    if (perpZ < -0.3) this.virtualInput.triggerAction(Action.MoveForward);
    if (perpZ > 0.3) this.virtualInput.triggerAction(Action.MoveBack);
    if (perpX > 0.3) this.virtualInput.triggerAction(Action.MoveRight);
    if (perpX < -0.3) this.virtualInput.triggerAction(Action.MoveLeft);

    if (distance > this.config.circleRange * 1.3) {
      this.transition(AIState.Approach);
    }
  }

  private handleTelegraph() {
    if (this.stateTimer <= 0) {
      this.chooseAttack();
      this.transition(AIState.Attack);
    }
  }

  private handleAttack() {
    if (this.pendingAttack) {
      this.virtualInput.triggerAction(this.pendingAttack);
      this.pendingAttack = null;
    }

    if (this.stateTimer <= 0) {
      this.transition(AIState.Recovery);
    }
  }

  private handleRecovery(distance: number) {
    if (this.stateTimer <= 0) {
      if (distance < this.config.retreatRange) {
        this.transition(AIState.Retreat);
      } else {
        this.transition(AIState.Idle);
      }
    }
  }

  private handleBlock(distance: number) {
    this.virtualInput.triggerAction(Action.Block);

    if (this.stateTimer <= 0) {
      if (distance < this.config.attackRange && Math.random() < 0.5) {
        this.transition(AIState.Telegraph);
      } else {
        this.transition(AIState.Idle);
      }
    }
  }

  private handleRetreat(distance: number, dir: THREE.Vector3) {
    if (distance > this.config.circleRange || this.stateTimer <= 0) {
      this.transition(AIState.Circle);
      return;
    }

    if (-dir.z < 0) this.virtualInput.triggerAction(Action.MoveForward);
    if (-dir.z > 0) this.virtualInput.triggerAction(Action.MoveBack);
    if (-dir.x > 0) this.virtualInput.triggerAction(Action.MoveRight);
    if (-dir.x < 0) this.virtualInput.triggerAction(Action.MoveLeft);
  }

  private handleStaggered() {
    if (this.stateTimer <= 0) {
      this.transition(AIState.Retreat);
    }
  }

  private tryDefend() {
    const roll = Math.random();
    if (roll < this.config.dodgeChance) {
      this.virtualInput.triggerAction(Action.Dodge);
      this.transition(AIState.Recovery);
    } else if (roll < this.config.dodgeChance + this.config.blockChance) {
      this.transition(AIState.Block);
    }
  }

  private chooseAttack() {
    const roll = Math.random();
    if (roll < 0.5) {
      this.pendingAttack = Action.LightAttack;
    } else if (roll < 0.8) {
      this.pendingAttack = Action.HeavyAttack;
    } else {
      this.pendingAttack = Action.Special;
    }
  }

  private transition(newState: AIState) {
    this.state = newState;

    switch (newState) {
      case AIState.Idle:
        this.stateTimer = this.randRange(this.config.idleDuration);
        break;
      case AIState.Circle:
        this.stateTimer = this.randRange(this.config.circleDuration);
        this.circleDirection = Math.random() < 0.5 ? 1 : -1;
        break;
      case AIState.Telegraph:
        this.stateTimer = this.config.telegraphDuration;
        break;
      case AIState.Attack:
        this.stateTimer = 0.4;
        break;
      case AIState.Recovery:
        this.stateTimer = this.config.recoveryDuration;
        break;
      case AIState.Block:
        this.stateTimer = 0.5 + Math.random() * 1;
        break;
      case AIState.Retreat:
        this.stateTimer = 1 + Math.random() * 1;
        break;
      case AIState.Staggered:
        this.stateTimer = 0.3;
        break;
      default:
        this.stateTimer = 0;
    }
  }

  private randRange([min, max]: [number, number]): number {
    return min + Math.random() * (max - min);
  }
}
