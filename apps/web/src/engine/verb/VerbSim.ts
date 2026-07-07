import * as THREE from 'three';
import {
  RiftEdge, RECALL_SWEEP_RADIUS,
  type EdgeAabb, type EdgeEvent, type EdgeState,
} from './RiftEdge';

/**
 * Headless graybox sim for the Verb (CLONE_PLAN.md slice 1).
 *
 * One hero, a handful of dummies, and the Rift Edge. This deliberately does
 * NOT touch CombatSim: the old stat-duel keeps working while the new combat
 * core proves itself here. The gate is feel: 30 seconds of muted play in the
 * graybox has to be fun before anything gets art, story, or an economy.
 *
 * Skill surface being prototyped:
 *  - melee: 3-hit string with buffered chaining, strike magnetism + lunge
 *  - throw: aimed, travel time, embeds where it lands
 *  - recall: magnet arc back through the fight, catch window
 *  - catch follow-up: attacking within the window after a catch skips the
 *    windup and hits harder — the rhythm GoW built a whole game on
 *  - dash: short burst for spacing
 *
 * The sim emits events; hit-pause, camera juice, audio and render all live in
 * the scene layer. Damage stays here.
 */

export interface DummySpec {
  pos: [number, number];
  /** Walkers shamble toward the hero so spacing/melee feel is testable. */
  walker?: boolean;
}

export interface VerbSimOptions {
  dummies: DummySpec[];
  blocks?: EdgeAabb[];
  heroPos?: [number, number];
}

export interface DummyState {
  id: number;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** Seconds of hit-flash left (render reads this for the emissive pulse). */
  flash: number;
  /** Seconds until a dead dummy stands back up. */
  respawn: number;
  walker: boolean;
  spawn: THREE.Vector3;
  vel: THREE.Vector3; // knockback impulse, decays
  stagger: number;
}

export type MeleeStage = 0 | 1 | 2 | 3; // 0 = idle, 1..3 = which strike is playing

export type VerbEvent =
  | { type: 'meleeSwing'; stage: MeleeStage; buffed: boolean }
  | { type: 'meleeHit'; stage: MeleeStage; dummyId: number; pos: THREE.Vector3; damage: number; buffed: boolean }
  | { type: 'meleeWhiff'; stage: MeleeStage }
  | { type: 'recallHit'; dummyId: number; pos: THREE.Vector3 }
  | { type: 'dummyDeath'; dummyId: number; pos: THREE.Vector3 }
  | { type: 'dash' }
  | Exclude<EdgeEvent, { type: 'recallSweep' }>;

// ── Tuning ───────────────────────────────────────────────────────────────────

const MOVE_SPEED = 5.2;
const AIM_MOVE_SPEED = 2.6;
const TURN_LERP = 14;

const DASH_SPEED = 11;
const DASH_TIME = 0.16;
const DASH_COOLDOWN = 0.45;

const MELEE_RANGE = 1.9;
const MELEE_ARC_COS = Math.cos((70 * Math.PI) / 180 / 2 + 0.5); // generous ~120° effective
const MAGNET_RANGE = 3.2;   // strike magnetism: snap facing + lunge toward this
const LUNGE_DIST = 0.55;

// Per-stage melee timing (s): hit lands at `active`, next input chains from
// `cancel`, string drops at `recover`. Armed = blade in hand.
interface StrikeSpec { active: number; cancel: number; recover: number; damage: number; knockback: number }
const ARMED: StrikeSpec[] = [
  { active: 0.12, cancel: 0.26, recover: 0.42, damage: 8,  knockback: 1.6 },
  { active: 0.12, cancel: 0.26, recover: 0.42, damage: 8,  knockback: 1.8 },
  { active: 0.17, cancel: 0.40, recover: 0.55, damage: 14, knockback: 4.2 },
];
const UNARMED: StrikeSpec[] = [
  { active: 0.09, cancel: 0.20, recover: 0.34, damage: 6,  knockback: 1.2 },
  { active: 0.09, cancel: 0.20, recover: 0.34, damage: 6,  knockback: 1.4 },
  { active: 0.14, cancel: 0.32, recover: 0.46, damage: 10, knockback: 3.4 },
];
/** Attack pressed within this window after a catch: skip windup, hit harder. */
const CATCH_FOLLOWUP_WINDOW = 0.28;
const CATCH_FOLLOWUP_MULT = 1.5;

const INPUT_BUFFER = 0.2;

const THROW_DAMAGE = 22;
const THROW_KNOCKBACK = 5;
const RECALL_DAMAGE = 12;
const RECALL_KNOCKBACK = 3;

const DUMMY_HP = 60;
const DUMMY_RADIUS = 0.45;
const DUMMY_RESPAWN = 2.5;
const WALKER_SPEED = 1.15;
const WALKER_STOP = 2.0;
const KNOCKBACK_DECAY = 6;

const HAND_HEIGHT = 1.25;
const HAND_RIGHT = 0.35;

/** Soft aim assist: a throw within this cone of a dummy snaps to its chest. */
const AIM_CONE_COS = Math.cos((12 * Math.PI) / 180);

// ─────────────────────────────────────────────────────────────────────────────

export class VerbSim {
  readonly heroPos: THREE.Vector3;
  heroYaw = 0;
  readonly edge = new RiftEdge();

  private dummies: DummyState[] = [];
  private blocks: EdgeAabb[];

  private moveX = 0;
  private moveY = 0;
  private cameraYaw = 0;
  private aiming = false;

  private attackBuffer = -1; // sim-time the press expires, -1 = empty
  private meleeStage: MeleeStage = 0;
  private meleeT = 0;
  private meleeHitDone = false;
  private meleeBuffed = false;
  private strikes: StrikeSpec[] = ARMED;

  private dashT = 0;
  private dashCooldown = 0;
  private dashDir = new THREE.Vector3(0, 0, 1);

  private catchWindow = 0;
  /** Dummies already clipped by the current recall sweep (hit once per pass). */
  private sweepHit = new Set<number>();

  private time = 0;
  private listeners: Array<(e: VerbEvent) => void> = [];

  constructor(opts: VerbSimOptions) {
    this.heroPos = new THREE.Vector3(opts.heroPos?.[0] ?? 0, 0, opts.heroPos?.[1] ?? 8);
    this.blocks = opts.blocks ?? [];
    this.dummies = opts.dummies.map((d, i) => ({
      id: i,
      pos: new THREE.Vector3(d.pos[0], 0, d.pos[1]),
      hp: DUMMY_HP,
      maxHp: DUMMY_HP,
      dead: false,
      flash: 0,
      respawn: 0,
      walker: !!d.walker,
      spawn: new THREE.Vector3(d.pos[0], 0, d.pos[1]),
      vel: new THREE.Vector3(),
      stagger: 0,
    }));

    this.edge.onEvent((e) => this.onEdgeEvent(e));
  }

  // ── Input (scene layer calls these) ────────────────────────────────────────

  setMove(x: number, y: number) { this.moveX = x; this.moveY = y; }
  setCameraYaw(yaw: number) { this.cameraYaw = yaw; }
  setAiming(aiming: boolean) { this.aiming = aiming; }

  /** LMB: melee when the Edge is anywhere, throw when aiming with it in hand. */
  pressAttack() {
    if (this.aiming && this.edge.state === 'held') {
      this.throwEdge();
      return;
    }
    this.attackBuffer = this.time + INPUT_BUFFER;
  }

  pressRecall() { this.edge.recall(this.handPos()); }

  pressDash() {
    if (this.dashCooldown > 0 || this.dashT > 0) return;
    const dir = this.moveWorldDir();
    this.dashDir.copy(dir.lengthSq() > 1e-4 ? dir : this.facingDir());
    this.dashT = DASH_TIME;
    this.dashCooldown = DASH_COOLDOWN;
    this.emit({ type: 'dash' });
  }

  // ── Public state (render layer reads these) ────────────────────────────────

  onEvent(cb: (e: VerbEvent) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((l) => l !== cb); };
  }

  getDummies(): readonly DummyState[] { return this.dummies; }
  get isAiming() { return this.aiming; }
  get edgeState(): EdgeState { return this.edge.state; }
  get meleeState(): { stage: MeleeStage; t: number } { return { stage: this.meleeStage, t: this.meleeT }; }
  get armed(): boolean { return this.edge.state === 'held'; }
  get dashing(): boolean { return this.dashT > 0; }

  /** Nearest living dummy — the camera's soft-lock target. */
  softLockTarget(): THREE.Vector3 | null {
    let best: DummyState | null = null;
    let bestD = Infinity;
    for (const d of this.dummies) {
      if (d.dead) continue;
      const dist = d.pos.distanceToSquared(this.heroPos);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best ? best.pos : null;
  }

  handPos(): THREE.Vector3 {
    const f = this.facingDir();
    const right = new THREE.Vector3(-f.z, 0, f.x);
    return this.heroPos.clone()
      .addScaledVector(right, HAND_RIGHT)
      .setY(HAND_HEIGHT);
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  step(dt: number) {
    this.time += dt;
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.catchWindow = Math.max(0, this.catchWindow - dt);

    this.updateHero(dt);
    this.updateMelee(dt);
    this.updateDummies(dt);
    this.edge.update(dt, this.handPos(), this.probe, this.blocks);
  }

  private updateHero(dt: number) {
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.heroPos.addScaledVector(this.dashDir, DASH_SPEED * dt);
    } else if (this.meleeStage === 0) {
      const dir = this.moveWorldDir();
      const speed = this.aiming ? AIM_MOVE_SPEED : MOVE_SPEED;
      this.heroPos.addScaledVector(dir, speed * dt);

      // Face movement; face the camera line while aiming.
      const face = this.aiming
        ? new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw))
        : dir;
      if (face.lengthSq() > 1e-4) {
        const target = Math.atan2(face.x, face.z);
        this.heroYaw = dampAngle(this.heroYaw, target, TURN_LERP, dt);
      }
    }
    this.keepOutOfBlocks();
  }

  private updateMelee(dt: number) {
    if (this.meleeStage === 0) {
      if (this.attackBuffer >= this.time) this.startStrike(1);
      return;
    }

    this.meleeT += dt;
    const spec = this.strikes[this.meleeStage - 1];

    if (!this.meleeHitDone && this.meleeT >= spec.active) {
      this.meleeHitDone = true;
      this.resolveStrike(spec);
    }
    if (this.meleeT >= spec.cancel && this.attackBuffer >= this.time && this.meleeStage < 3) {
      this.startStrike((this.meleeStage + 1) as MeleeStage);
      return;
    }
    if (this.meleeT >= spec.recover) {
      this.meleeStage = 0;
      this.meleeT = 0;
    }
  }

  private startStrike(stage: MeleeStage) {
    this.attackBuffer = -1;
    this.strikes = this.armed ? ARMED : UNARMED;
    this.meleeStage = stage;
    this.meleeHitDone = false;
    this.meleeBuffed = stage === 1 && this.catchWindow > 0;
    // The catch follow-up lands NOW — the windup is the reward that got skipped.
    this.meleeT = this.meleeBuffed ? this.strikes[0].active : 0;
    this.catchWindow = 0;

    // Strike magnetism: square up on the nearest dummy in front and lunge.
    const target = this.nearestInMagnetRange();
    if (target) {
      const to = new THREE.Vector3().subVectors(target.pos, this.heroPos).setY(0);
      if (to.lengthSq() > 1e-4) {
        this.heroYaw = Math.atan2(to.x, to.z);
        const gap = to.length() - (MELEE_RANGE - 0.4);
        if (gap > 0) this.heroPos.addScaledVector(to.normalize(), Math.min(LUNGE_DIST, gap));
      }
    }
    this.emit({ type: 'meleeSwing', stage, buffed: this.meleeBuffed });
  }

  private resolveStrike(spec: StrikeSpec) {
    const facing = this.facingDir();
    const mult = this.meleeBuffed ? CATCH_FOLLOWUP_MULT : 1;
    let landed = false;

    for (const d of this.dummies) {
      if (d.dead) continue;
      const to = new THREE.Vector3().subVectors(d.pos, this.heroPos).setY(0);
      const dist = to.length();
      if (dist > MELEE_RANGE + DUMMY_RADIUS) continue;
      if (dist > 0.01 && to.normalize().dot(facing) < MELEE_ARC_COS) continue;

      landed = true;
      this.damageDummy(d, Math.round(spec.damage * mult), facing, spec.knockback);
      this.emit({
        type: 'meleeHit', stage: this.meleeStage, dummyId: d.id,
        pos: d.pos.clone().setY(1.1), damage: Math.round(spec.damage * mult),
        buffed: this.meleeBuffed,
      });
    }
    if (!landed) this.emit({ type: 'meleeWhiff', stage: this.meleeStage });
  }

  private throwEdge() {
    const hand = this.handPos();
    const dir = this.aimDir(hand);
    this.edge.throw(hand, dir);
  }

  /** Camera-forward aim with a soft cone snap to the nearest dummy chest. */
  private aimDir(from: THREE.Vector3): THREE.Vector3 {
    const forward = new THREE.Vector3(
      -Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    let best: THREE.Vector3 | null = null;
    let bestDot = AIM_CONE_COS;
    for (const d of this.dummies) {
      if (d.dead) continue;
      const chest = d.pos.clone().setY(1.1);
      const to = chest.clone().sub(from).normalize();
      const dot = to.clone().setY(0).normalize().dot(forward);
      if (dot > bestDot) { bestDot = dot; best = chest.clone().sub(from).normalize(); }
    }
    return best ?? forward;
  }

  private onEdgeEvent(e: EdgeEvent) {
    if (e.type === 'embed' && e.target.kind === 'enemy') {
      const d = this.dummies[e.target.id];
      if (d && !d.dead) {
        this.damageDummy(d, THROW_DAMAGE, this.edge.dir, THROW_KNOCKBACK);
      }
    }
    if (e.type === 'recallStart') this.sweepHit.clear();
    if (e.type === 'recallSweep') {
      // Per-frame sweep stays internal; the scene hears discrete recallHits.
      for (const d of this.dummies) {
        if (d.dead || this.sweepHit.has(d.id)) continue;
        const flat = d.pos.clone().setY(0).distanceTo(e.pos.clone().setY(0));
        if (flat <= RECALL_SWEEP_RADIUS + DUMMY_RADIUS && e.pos.y < 1.9) {
          this.sweepHit.add(d.id);
          this.damageDummy(d, RECALL_DAMAGE, e.dir, RECALL_KNOCKBACK);
          this.emit({ type: 'recallHit', dummyId: d.id, pos: d.pos.clone().setY(1.1) });
        }
      }
      return;
    }
    if (e.type === 'catch') this.catchWindow = CATCH_FOLLOWUP_WINDOW;
    this.emit(e);
  }

  private damageDummy(d: DummyState, amount: number, dir: THREE.Vector3, knockback: number) {
    d.hp -= amount;
    d.flash = 0.18;
    d.stagger = 0.25;
    const push = dir.clone().setY(0);
    if (push.lengthSq() > 1e-4) d.vel.addScaledVector(push.normalize(), knockback);
    if (d.hp <= 0) {
      d.dead = true;
      d.respawn = DUMMY_RESPAWN;
      this.emit({ type: 'dummyDeath', dummyId: d.id, pos: d.pos.clone() });
    }
  }

  private updateDummies(dt: number) {
    for (const d of this.dummies) {
      d.flash = Math.max(0, d.flash - dt);
      d.stagger = Math.max(0, d.stagger - dt);

      if (d.dead) {
        d.respawn -= dt;
        if (d.respawn <= 0) {
          d.dead = false;
          d.hp = d.maxHp;
          d.pos.copy(d.spawn);
          d.vel.set(0, 0, 0);
        }
        continue;
      }

      // Knockback impulse decays exponentially.
      if (d.vel.lengthSq() > 1e-4) {
        d.pos.addScaledVector(d.vel, dt);
        d.vel.multiplyScalar(Math.max(0, 1 - KNOCKBACK_DECAY * dt));
      }

      if (d.walker && d.stagger <= 0) {
        const to = new THREE.Vector3().subVectors(this.heroPos, d.pos).setY(0);
        if (to.length() > WALKER_STOP) {
          d.pos.addScaledVector(to.normalize(), WALKER_SPEED * dt);
        }
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private readonly probe = {
    enemyAt: (pos: THREE.Vector3, radius: number): number | null => {
      for (const d of this.dummies) {
        if (d.dead) continue;
        const flat = d.pos.clone().setY(0).distanceTo(pos.clone().setY(0));
        if (flat <= radius + DUMMY_RADIUS && pos.y >= 0.15 && pos.y <= 1.85) return d.id;
      }
      return null;
    },
    enemyPos: (id: number): THREE.Vector3 | null => {
      const d = this.dummies[id];
      return d && !d.dead ? d.pos.clone().setY(1.1) : null;
    },
  };

  /** Camera-relative move direction on the ground plane (matches BattleCamera's yaw contract). */
  private moveWorldDir(): THREE.Vector3 {
    const fwd = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = new THREE.Vector3()
      .addScaledVector(fwd, this.moveY)
      .addScaledVector(right, this.moveX);
    return dir.lengthSq() > 1 ? dir.normalize() : dir;
  }

  private facingDir(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heroYaw), 0, Math.cos(this.heroYaw));
  }

  private nearestInMagnetRange(): DummyState | null {
    const facing = this.facingDir();
    let best: DummyState | null = null;
    let bestDist = MAGNET_RANGE;
    for (const d of this.dummies) {
      if (d.dead) continue;
      const to = new THREE.Vector3().subVectors(d.pos, this.heroPos).setY(0);
      const dist = to.length();
      if (dist > MAGNET_RANGE) continue;
      // In front-ish, or basically on top of us.
      if (dist > 0.6 && to.normalize().dot(facing) < 0.1) continue;
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    return best;
  }

  private keepOutOfBlocks() {
    const r = 0.4;
    for (const b of this.blocks) {
      if (b.max[1] < 0.4) continue; // low debris, step over
      const px = this.heroPos.x; const pz = this.heroPos.z;
      const cx = THREE.MathUtils.clamp(px, b.min[0], b.max[0]);
      const cz = THREE.MathUtils.clamp(pz, b.min[2], b.max[2]);
      const dx = px - cx; const dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 < 1e-9) { this.heroPos.z = b.max[2] + r; continue; }
        const d = Math.sqrt(d2);
        this.heroPos.x = cx + (dx / d) * r;
        this.heroPos.z = cz + (dz / d) * r;
      }
    }
  }

  private emit(e: VerbEvent) {
    for (const l of this.listeners) l(e);
  }
}

/** Frame-rate independent angular damp (shortest path). */
function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}
