import * as THREE from 'three';
import { CharacterController } from '../character';
import { AnimState, type HitDirection } from '../animation';
import { Action, InputSystem } from '../input/InputSystem';
import {
  DamageSystem, type DamageEvent,
  ComboSystem, MoveType, canGatlingCancel,
  CLASS_FRAME_DATA, getHitboxWindow, hitboxHits, hitboxContactPoint,
  getMoveForAction,
  EnemyAI, AIDifficulty,
} from '../combat';
import { KnockbackPhysics } from '../vfx/KnockbackPhysics';

/**
 * Headless, render-free authoritative combat core.
 *
 * This is the single source of truth for what happens in a fight. It runs with
 * no Three rendering, no AnimationMixer, no DOM/WebGL — only vector math — so the
 * exact same code can tick on a Node server (authoritative for ranked PvP, see
 * docs/PVP_NETCODE.md) and on the client for prediction. The attack timeline is
 * driven by frame data on the sim clock (replacing the AnimationStateMachine,
 * which on the client was acting as the hit clock). The sim emits DamageEvents +
 * per-fighter `animState`; the client maps those to animations, VFX, audio and
 * camera — none of which live here.
 *
 * NOTE (migration): the client `GameScene` still runs its own copy of this loop.
 * The next slice migrates it to delegate here so there is exactly one combat
 * implementation. This module is built to be that single source.
 */

export type FighterId = 'p1' | 'p2';
export type ClassId = 'berserker' | 'sentinel' | 'phantom';

const MOVE_STAMINA: Record<string, number> = {
  [AnimState.LightAttack]: 5,
  [AnimState.HeavyAttack]: 15,
  [AnimState.Special]: 30,
  [AnimState.JumpAttack]: 15,
};

const STAGGER_DURATION: Record<string, number> = {
  light: 0.2,
  heavy: 0.45,
  special: 0.7,
};

const ANIM_TO_MOVE: Partial<Record<AnimState, MoveType>> = {
  [AnimState.LightAttack]: MoveType.LightAttack,
  [AnimState.HeavyAttack]: MoveType.HeavyAttack,
  [AnimState.Special]: MoveType.Special,
  [AnimState.JumpAttack]: MoveType.HeavyAttack,
};

// AI follow-up Action → the attack animation startAttack expects.
const AI_ACTION_TO_ANIM: Partial<Record<Action, AnimState>> = {
  [Action.LightAttack]: AnimState.LightAttack,
  [Action.HeavyAttack]: AnimState.HeavyAttack,
  [Action.Special]: AnimState.Special,
};

const FIGHTER_SEPARATION = 1.5;
const FIXED_DT = 1 / 60; // reference tick the frame data is authored against

/** Serializable per-fighter snapshot — exactly what a StateUpdate carries. */
export interface SimFighterState {
  id: FighterId;
  classId: ClassId;
  position: [number, number, number];
  rotation: number;
  velocity: [number, number, number];
  health: number;
  maxHealth: number;
  stamina: number;
  staminaMax: number;
  animState: AnimState;
  isAttacking: boolean;
  isBlocking: boolean;
  isDodging: boolean;
  isStaggered: boolean;
  isGrounded: boolean;
  isDead: boolean;
}

export interface SimSnapshot {
  tick: number;
  fighters: Record<FighterId, SimFighterState>;
  winner: FighterId | null;
}

/** Authoritative event the client renders (hit sparks, KO, etc.). */
export type SimEvent =
  | { kind: 'hit'; event: DamageEvent; comboCount: number; direction: HitDirection }
  | { kind: 'attackStart'; fighter: FighterId; anim: AnimState }
  | { kind: 'ko'; winner: FighterId; loser: FighterId };

interface AttackTrack {
  active: boolean;
  anim: AnimState;
  elapsed: number;   // seconds into the current attack
  duration: number;  // total seconds (frame data total / 60)
  consumed: Set<number>; // hitbox indices already landed this swing
  chain: MoveType[]; // current cancel string, for gatling routing
}

interface Fighter {
  id: FighterId;
  classId: ClassId;
  ctrl: CharacterController;
  attack: AttackTrack;
  reactionAnim: AnimState; // hit-reaction clip to show while staggered
}

// Where did the blow land relative to the defender's facing?
function hitDirection(defender: CharacterController, knockbackDir: THREE.Vector3): HitDirection {
  const toAttacker = new THREE.Vector3(-knockbackDir.x, 0, -knockbackDir.z);
  if (toAttacker.lengthSq() < 1e-6) return 'front';
  toAttacker.normalize();
  const fwd = new THREE.Vector3(Math.sin(defender.state.rotation), 0, Math.cos(defender.state.rotation));
  const dot = fwd.dot(toAttacker);
  if (dot > 0.4) return 'front';
  if (dot < -0.4) return 'back';
  return 'side';
}

function attackDuration(classId: ClassId, anim: AnimState): number {
  const fdState = anim === AnimState.JumpAttack ? AnimState.HeavyAttack : anim;
  const fd = CLASS_FRAME_DATA[classId]?.[fdState];
  if (!fd) return 0.4;
  return (fd.startup + fd.active + fd.recovery) / 60;
}

export class CombatSim {
  readonly damage = new DamageSystem();
  readonly combos = new ComboSystem();
  readonly knockback = new KnockbackPhysics();

  private fighters: Record<FighterId, Fighter>;
  private ais: Partial<Record<FighterId, EnemyAI>> = {};
  private tick = 0;
  private winner: FighterId | null = null;
  private events: SimEvent[] = [];

  constructor(p1Class: ClassId, p2Class: ClassId) {
    const mk = (id: FighterId, classId: ClassId, x: number): Fighter => ({
      id,
      classId,
      ctrl: new CharacterController(new THREE.Vector3(x, 0, 0)),
      attack: { active: false, anim: AnimState.LightAttack, elapsed: 0, duration: 0, consumed: new Set(), chain: [] },
      reactionAnim: AnimState.HitLight,
    });

    this.fighters = {
      p1: mk('p1', p1Class, -2.5),
      p2: mk('p2', p2Class, 2.5),
    };

    for (const id of ['p1', 'p2'] as FighterId[]) {
      this.damage.registerFighter(id, this.fighters[id].classId);
      this.combos.register(id, this.fighters[id].classId);
      this.knockback.register(id);
    }
    this.fighters.p1.ctrl.setLockOnTarget(this.fighters.p2.ctrl);
    this.fighters.p2.ctrl.setLockOnTarget(this.fighters.p1.ctrl);

    this.damage.onDamage((event) => this.onDamage(event));
  }

  get isOver(): boolean {
    return this.winner !== null;
  }

  getWinner(): FighterId | null {
    return this.winner;
  }

  /** Read-only access to a fighter's controller (for client rendering). */
  controller(id: FighterId): CharacterController {
    return this.fighters[id].ctrl;
  }

  /** Normalized progress (0..1) of a fighter's current attack, or 0 if not
   *  attacking — the renderer uses it to drive the weapon-trail arc. */
  attackProgress(id: FighterId): number {
    const a = this.fighters[id].attack;
    if (!a.active || a.duration <= 0) return 0;
    return Math.min(1, a.elapsed / a.duration);
  }

  /** The combo state for a fighter (HUD count, etc.). */
  comboState(id: FighterId) {
    return this.combos.getState(id);
  }

  /**
   * Make a fighter AI-controlled (PvE). The sim then drives that fighter's input
   * and combo follow-ups internally; the caller need not provide its InputSystem.
   * Leave a fighter un-attached for human/network control via `step`'s inputs.
   */
  attachAI(id: FighterId, difficulty: AIDifficulty) {
    this.ais[id] = new EnemyAI(difficulty, this.fighters[id].classId);
  }

  private inputFor(id: FighterId, inputs: Partial<Record<FighterId, InputSystem>>): InputSystem {
    const ai = this.ais[id];
    if (ai) return ai.getInput();
    const provided = inputs[id];
    if (!provided) throw new Error(`No input or AI for fighter ${id}`);
    return provided;
  }

  /**
   * Advance the fight one step. Inputs are virtual InputSystems (the caller —
   * server or client — sets actions on them); `dt` is the real elapsed time.
   * Returns the authoritative events produced this step.
   */
  step(
    dt: number,
    inputs: Partial<Record<FighterId, InputSystem>> = {},
    cameraYaw: Partial<Record<FighterId, number>> = {},
  ): SimEvent[] {
    this.events = [];
    if (this.winner !== null) return this.events;

    this.tick++;
    const clampedDt = Math.min(dt, 0.05);
    const ids = ['p1', 'p2'] as FighterId[];

    // 0. AI-controlled fighters decide their input first (movement + buffered attack).
    for (const id of ids) {
      const ai = this.ais[id];
      if (ai) {
        const opp = id === 'p1' ? 'p2' : 'p1';
        ai.update(clampedDt, this.fighters[id].ctrl, this.fighters[opp].ctrl);
      }
    }

    // 1. Movement / dodge / block / jump. Camera-relative on the client (the local
    //    player passes its camera yaw); the server passes none → world-frame (0).
    for (const id of ids) {
      const f = this.fighters[id];
      if (!f.ctrl.state.isDead) f.ctrl.update(clampedDt, this.inputFor(id, inputs), cameraYaw[id] ?? 0);
    }

    // 2. Attack triggers (buffered, cancel-window + gatling gating). AI fighters
    //    also chain their queued combo follow-ups through the same cancel gate.
    for (const id of ids) {
      this.handleAttackInput(id, this.inputFor(id, inputs));
      this.handleAiFollowup(id);
    }

    // 3. Keep bodies from overlapping.
    this.fighters.p1.ctrl.separateFrom(this.fighters.p2.ctrl, FIGHTER_SEPARATION);

    // 4. Advance attack timelines + resolve hits (animation-clock-free).
    this.resolveAttack('p1', 'p2', clampedDt);
    this.resolveAttack('p2', 'p1', clampedDt);

    // 5. Systems.
    this.knockback.update(clampedDt, 'p1', this.fighters.p1.ctrl);
    this.knockback.update(clampedDt, 'p2', this.fighters.p2.ctrl);
    this.damage.updateStamina(clampedDt);
    this.combos.update(clampedDt);

    // 6. Advance input frame edges.
    for (const id of ids) this.inputFor(id, inputs).update();

    return this.events;
  }

  // Chain an AI fighter's queued combo follow-ups via the same cancel gate the
  // player uses (the AI builds class routes; we pull them one per cancel window).
  private handleAiFollowup(id: FighterId) {
    const ai = this.ais[id];
    if (!ai) return;
    if (!this.fighters[id].attack.active || !this.canCancel(id)) return;
    const next = ai.takeFollowUp();
    const anim = next ? AI_ACTION_TO_ANIM[next] : undefined;
    if (anim) this.startAttack(id, anim, true);
  }

  // ── Attack lifecycle ──────────────────────────────────────────────────────

  private canCancel(id: FighterId): boolean {
    const f = this.fighters[id];
    if (!f.attack.active) return true;
    const progress = f.attack.duration > 0 ? f.attack.elapsed / f.attack.duration : 1;
    const fdState = f.attack.anim === AnimState.JumpAttack ? AnimState.HeavyAttack : f.attack.anim;
    const fd = CLASS_FRAME_DATA[f.classId]?.[fdState];
    if (!fd) return progress > 0.5;
    const total = fd.startup + fd.active + fd.recovery;
    const activeStart = fd.startup / total;
    const recoveryStart = (fd.startup + fd.active) / total;
    // On a confirmed hit, cancel from the active frames; on a whiff, only in recovery.
    return f.attack.consumed.size > 0 ? progress >= activeStart : progress >= recoveryStart;
  }

  private handleAttackInput(id: FighterId, input: InputSystem) {
    const f = this.fighters[id];
    const attacking = f.attack.active;
    if (attacking && !this.canCancel(id)) return;

    const onRoute = (mv: MoveType) => !attacking || canGatlingCancel(f.classId, f.attack.chain, mv);

    if (onRoute(MoveType.LightAttack) && input.consumeBuffered(Action.LightAttack)) {
      this.startAttack(id, AnimState.LightAttack, attacking);
    } else if (onRoute(MoveType.HeavyAttack) && input.consumeBuffered(Action.HeavyAttack)) {
      this.startAttack(id, AnimState.HeavyAttack, attacking);
    } else if (onRoute(MoveType.Special) && input.consumeBuffered(Action.Special)) {
      this.startAttack(id, AnimState.Special, attacking);
    }
  }

  private startAttack(id: FighterId, animState: AnimState, isCancel: boolean) {
    const f = this.fighters[id];
    const s = f.ctrl.state;
    if (s.isDodging || s.isStaggered || s.isDead) return;
    if (s.isAttacking && !isCancel) return;

    const move = s.isGrounded ? animState : AnimState.JumpAttack;

    const cost = MOVE_STAMINA[move] ?? 10;
    if (!this.damage.hasStamina(id, cost)) return;
    this.damage.consumeStamina(id, cost);

    s.isAttacking = true;
    f.attack.active = true;
    f.attack.anim = move;
    f.attack.elapsed = 0;
    f.attack.duration = attackDuration(f.classId, move);
    f.attack.consumed.clear();

    const mv = ANIM_TO_MOVE[move];
    if (isCancel && mv) f.attack.chain = [...f.attack.chain, mv];
    else f.attack.chain = mv ? [mv] : [];

    // Committed step into the strike (front-loaded), then plants.
    const target = this.fighters[id === 'p1' ? 'p2' : 'p1'].ctrl;
    const lungeDir = new THREE.Vector3().subVectors(target.state.position, s.position).setY(0).normalize();
    const dist = s.position.distanceTo(target.state.position);
    const stepInto = move === AnimState.LightAttack ? 0.5 : move === AnimState.HeavyAttack ? 0.95 : 1.3;
    const gap = Math.max(0, dist - 1.1);
    f.ctrl.applyLunge(lungeDir, Math.min(stepInto, gap));
    if (!s.isGrounded) s.velocity.y = Math.min(s.velocity.y, -3);

    // Tell the renderer to (re)play the swing clip — needed so a cancel into the
    // same move restarts the animation instead of holding the last pose.
    this.events.push({ kind: 'attackStart', fighter: id, anim: move });
  }

  private resolveAttack(attackerId: FighterId, defenderId: FighterId, dt: number) {
    const atk = this.fighters[attackerId];
    const def = this.fighters[defenderId];
    if (!atk.attack.active) return;

    atk.attack.elapsed += dt;
    const progress = atk.attack.duration > 0 ? atk.attack.elapsed / atk.attack.duration : 1;

    if (progress >= 1) {
      // Clip finished → release control.
      atk.attack.active = false;
      atk.ctrl.state.isAttacking = false;
      return;
    }

    const fdState = atk.attack.anim === AnimState.JumpAttack ? AnimState.HeavyAttack : atk.attack.anim;
    const fd = CLASS_FRAME_DATA[atk.classId]?.[fdState];
    const moveType = ANIM_TO_MOVE[atk.attack.anim];
    const move = moveType ? getMoveForAction(atk.classId, moveType) : undefined;
    if (!fd || !move) return;

    fd.hitboxes.forEach((hb, i) => {
      if (atk.attack.consumed.has(i)) return;
      const win = getHitboxWindow(fd, hb);
      if (progress < win.start || progress > win.end) return;
      if (hitboxHits(hb, atk.ctrl.state.position, atk.ctrl.state.rotation, def.ctrl.state.position)) {
        atk.attack.consumed.add(i);
        const contact = hitboxContactPoint(hb, atk.ctrl.state.position, atk.ctrl.state.rotation);
        this.damage.calculateAndApply(attackerId, defenderId, atk.ctrl, def.ctrl, hb, move, contact);
      }
    });
  }

  // ── On-hit reactions (sim-affecting only; VFX live on the client) ───────────

  private onDamage(event: DamageEvent) {
    const attacker = this.fighters[event.attackerId as FighterId];
    const defender = this.fighters[event.defenderId as FighterId];
    const dir = hitDirection(defender.ctrl, event.knockbackDir);

    // Parry: attacker bounces off the guard, stunned.
    if (event.parried) {
      attacker.attack.active = false;
      attacker.ctrl.state.isAttacking = false;
      attacker.ctrl.applyStagger(0.7, 0.2);
      attacker.reactionAnim = AnimState.HitHeavy;
      this.events.push({ kind: 'hit', event, comboCount: 0, direction: dir });
      return;
    }

    if (!event.blocked) {
      this.combos.registerHit(event.attackerId, event.hitType === 'light'
        ? MoveType.LightAttack
        : event.hitType === 'heavy' ? MoveType.HeavyAttack : MoveType.Special);
      const comboCount = this.combos.getState(event.attackerId)?.count ?? 1;
      const comboPush = 1 + Math.min(comboCount, 8) * 0.12;

      this.knockback.applyKnockback(event.defenderId, {
        direction: event.knockbackDir,
        force: event.knockbackForce * comboPush,
        hitType: event.hitType,
        killed: event.killed,
      });

      // Reaction tier: special / deep combo → knockdown; heavy → stagger; light → flinch.
      const knockdown = event.hitType === 'special' || comboCount >= 5;
      if (knockdown) {
        defender.reactionAnim = AnimState.Knockdown;
        defender.ctrl.applyStagger(1.5, 0);
      } else {
        defender.reactionAnim = event.hitType === 'heavy' ? AnimState.HitHeavy : AnimState.HitLight;
        defender.ctrl.applyStagger(STAGGER_DURATION[event.hitType] ?? 0.3);
      }

      // The struck fighter's own attack + combo are interrupted.
      defender.attack.active = false;
      defender.ctrl.state.isAttacking = false;
      this.combos.drop(event.defenderId);

      this.events.push({ kind: 'hit', event, comboCount, direction: dir });
    } else {
      this.events.push({ kind: 'hit', event, comboCount: 0, direction: dir });
    }

    if (event.killed && this.winner === null) {
      const winner = event.defenderId === 'p2' ? 'p1' : 'p2';
      const loser = event.defenderId as FighterId;
      this.winner = winner;
      this.events.push({ kind: 'ko', winner, loser });
    }
  }

  // ── Snapshot ────────────────────────────────────────────────────────────────

  private animStateOf(f: Fighter): AnimState {
    const s = f.ctrl.state;
    if (s.isDead) return AnimState.Death;
    if (f.attack.active) return f.attack.anim;
    if (s.isStaggered) return f.reactionAnim;
    if (s.isDodging) return AnimState.Dodge;
    if (!s.isGrounded) return AnimState.Jump;
    if (s.isBlocking) return AnimState.Block;
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    if (speed > 0.2) return s.isRunning ? AnimState.Run : AnimState.Walk;
    return AnimState.Idle;
  }

  private fighterState(f: Fighter): SimFighterState {
    const s = f.ctrl.state;
    const stats = this.damage.getStats(f.id);
    return {
      id: f.id,
      classId: f.classId,
      position: [s.position.x, s.position.y, s.position.z],
      rotation: s.rotation,
      velocity: [s.velocity.x, s.velocity.y, s.velocity.z],
      health: s.health,
      maxHealth: s.maxHealth,
      stamina: stats?.stamina ?? 0,
      staminaMax: stats?.staminaMax ?? 100,
      animState: this.animStateOf(f),
      isAttacking: f.attack.active,
      isBlocking: s.isBlocking,
      isDodging: s.isDodging,
      isStaggered: s.isStaggered,
      isGrounded: s.isGrounded,
      isDead: s.isDead,
    };
  }

  snapshot(): SimSnapshot {
    return {
      tick: this.tick,
      fighters: { p1: this.fighterState(this.fighters.p1), p2: this.fighterState(this.fighters.p2) },
      winner: this.winner,
    };
  }
}

export { FIXED_DT };
