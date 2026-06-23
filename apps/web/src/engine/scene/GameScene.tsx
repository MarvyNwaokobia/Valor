'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback, type MutableRefObject } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FighterModel } from './FighterModel';
import { ArenaStage, type StageId } from './ArenaStage';
import { BattleCamera } from '../camera';
import { CharacterController } from '../character';
import { AnimationStateMachine, AnimState, CLASS_ANIMATIONS, type HitDirection } from '../animation';
import { Action, getInputSystem } from '../input';
import { TouchControls } from '../input/TouchControls';
import { DamageSystem, type DamageEvent } from '../combat/DamageSystem';
import { ComboSystem, type ComboState, MoveType, CLASS_FRAME_DATA, getHitboxWindow, hitboxHits, hitboxContactPoint, getMoveForAction, canGatlingCancel } from '../combat';
import { EnemyAI, AIDifficulty } from '../combat/EnemyAI';
import { ParticleSystem } from '../vfx/ParticleSystem';
import { KnockbackPhysics } from '../vfx/KnockbackPhysics';
import { TrailRenderer } from '../vfx/TrailRenderer';
import { CombatAudio } from '../audio/CombatAudio';
import { ScreenEffects } from '../vfx/ScreenEffects';
import { ScreenFlashOverlay } from '../vfx/ScreenFlashOverlay';
import { StageLighting } from '../world/StageLighting';
import { AmbientVFX } from '../world/AmbientVFX';
import { Crowd } from '../world/Crowd';
import { CrowdDirector } from '../world/CrowdDirector';

type ClassId = 'berserker' | 'sentinel' | 'phantom';

interface GameSceneProps {
  playerClass: ClassId;
  enemyClass: ClassId;
  stageId?: StageId;
  enemyName?: string;
  difficulty?: AIDifficulty;
  onDamageEvent?: (event: DamageEvent) => void;
  onComboUpdate?: (combo: ComboState | null) => void;
  onPlayerStateUpdate?: (health: number, maxHealth: number, stamina: number, staminaMax: number) => void;
  onEnemyStateUpdate?: (health: number, maxHealth: number) => void;
  onBattleEnd?: (winner: 'player' | 'enemy', durationSecs: number) => void;
  // Rewards earned this fight, shown on the victory screen (server-authoritative).
  rewardPending?: boolean;
  reward?: { won: boolean; xpAwarded: number; rankedUp: boolean; newRank: string | null; gAwarded: number } | null;
}

const CLASS_ACCENTS: Record<string, string> = {
  berserker: '#ff4422',
  sentinel: '#4488ff',
  phantom: '#aa44ff',
};

// Maps an attack animation state to its move definition (for damage/blockable rules).
const ANIM_TO_MOVE: Partial<Record<AnimState, MoveType>> = {
  [AnimState.LightAttack]: MoveType.LightAttack,
  [AnimState.HeavyAttack]: MoveType.HeavyAttack,
  [AnimState.Special]: MoveType.Special,
  [AnimState.JumpAttack]: MoveType.HeavyAttack,
};

// The attack the AI queues (an Action) → the animation state doAttack expects.
const AI_ATTACK_ANIM: Partial<Record<Action, AnimState>> = {
  [Action.LightAttack]: AnimState.LightAttack,
  [Action.HeavyAttack]: AnimState.HeavyAttack,
  [Action.Special]: AnimState.Special,
};

// Where did the blow land relative to the defender's facing? knockbackDir points
// attacker → defender, so the attacker sits the opposite way.
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

const HITSTOP_DURATION: Record<string, number> = {
  light: 0.05,
  heavy: 0.1,
  special: 0.15,
  kill: 0.35,
};

const STAGGER_DURATION: Record<string, number> = {
  light: 0.2,
  heavy: 0.45,
  special: 0.7,
};

const FOOTSTEP_INTERVAL = 0.3;
const FOOTSTEP_SPEED_THRESHOLD = 1.0;

// Minimum center-to-center distance between fighters' bodies. Below the
// attack range (2.0) so strikes still connect, but wide enough that the
// two characters never visually clip into each other.
const FIGHTER_SEPARATION = 1.5;

function BattleWorld({
  playerClass,
  enemyClass,
  stageId = 'lava_arena',
  difficulty = AIDifficulty.Medium,
  onDamageEvent,
  onComboUpdate,
  onPlayerStateUpdate,
  onEnemyStateUpdate,
  onBattleEnd,
  onReady,
  combatActive = false,
  screenFx,
}: GameSceneProps & { difficulty: AIDifficulty; onReady?: () => void; combatActive?: boolean; screenFx: ScreenEffects }) {
  const { camera } = useThree();
  const perspCamera = camera as THREE.PerspectiveCamera;
  const battleEndedRef = useRef(false);
  const combatActiveRef = useRef(false);
  combatActiveRef.current = combatActive;
  const readyFired = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!readyFired.current) {
        readyFired.current = true;
        onReady?.();
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [onReady]);

  const input = useMemo(() => getInputSystem(), []);
  const battleCamera = useMemo(() => new BattleCamera(perspCamera), [perspCamera]);

  const playerController = useMemo(() => new CharacterController(new THREE.Vector3(-2.5, 0, 0)), []);
  const enemyController = useMemo(() => new CharacterController(new THREE.Vector3(2.5, 0, 0)), []);

  const playerAnimMachine = useMemo(() => new AnimationStateMachine(CLASS_ANIMATIONS[playerClass]), [playerClass]);
  const enemyAnimMachine = useMemo(() => new AnimationStateMachine(CLASS_ANIMATIONS[enemyClass]), [enemyClass]);

  const damageSystem = useMemo(() => new DamageSystem(), []);
  const comboSystem = useMemo(() => new ComboSystem(), []);
  const enemyAI = useMemo(() => new EnemyAI(difficulty, enemyClass), [difficulty, enemyClass]);
  const knockback = useMemo(() => new KnockbackPhysics(), []);
  const combatAudio = useMemo(() => new CombatAudio(), []);
  const particles = useMemo(() => new ParticleSystem(), []);
  const crowd = useMemo(() => new CrowdDirector(), []);

  const playerAttackingRef = useRef(false);
  const enemyAttackingRef = useRef(false);
  // Hitbox indices already consumed in the current swing (one hit per box per attack).
  const playerHitConsumed = useRef<Set<number>>(new Set());
  const enemyHitConsumed = useRef<Set<number>>(new Set());
  const playerAttackTypeRef = useRef<AnimState>(AnimState.LightAttack);
  const enemyAttackTypeRef = useRef<AnimState>(AnimState.LightAttack);
  // The current attack-cancel string per fighter (move types), so cancels can be
  // gated to this class's combo routes. Reset on a fresh attack, extended on cancel.
  const playerChainRef = useRef<MoveType[]>([]);
  const enemyChainRef = useRef<MoveType[]>([]);

  // Hit-stop
  const hitStopTimerRef = useRef(0);

  // Weapon trails
  const playerTrail = useMemo(() => new TrailRenderer(CLASS_ACCENTS[playerClass], 24, 0.18, 0.42), [playerClass]);
  const enemyTrail = useMemo(() => new TrailRenderer(CLASS_ACCENTS[enemyClass], 24, 0.18, 0.42), [enemyClass]);

  // Track the stagger edge so we can snap out of the (non-interruptible) hit clip
  // the instant the fighter recovers or techs into block/dodge.
  const playerWasStaggered = useRef(false);
  const enemyWasStaggered = useRef(false);

  // Footstep timer
  const playerStepTimerRef = useRef(0);
  const enemyStepTimerRef = useRef(0);

  // Background music
  const bgmStartedRef = useRef(false);
  // Wall-clock start of live combat, for the fight-duration reward guard.
  const combatStartRef = useRef(0);

  useEffect(() => {
    damageSystem.registerFighter('player', playerClass);
    damageSystem.registerFighter('enemy', enemyClass);
    comboSystem.register('player', playerClass);
    comboSystem.register('enemy', enemyClass);
    knockback.register('player');
    knockback.register('enemy');
    playerController.setLockOnTarget(enemyController);
    enemyController.setLockOnTarget(playerController);
    battleCamera.setLockedOn(true);

    damageSystem.onDamage((event) => {
      onDamageEvent?.(event);

      // --- Parry: the defender caught it clean. Punish the attacker. ---
      if (event.parried) {
        const attackerCtrl = event.attackerId === 'enemy' ? enemyController : playerController;
        const attackerAnim = event.attackerId === 'enemy' ? enemyAnimMachine : playerAnimMachine;
        const attackerRef = event.attackerId === 'enemy' ? enemyAttackingRef : playerAttackingRef;
        const defenderAnim = event.defenderId === 'enemy' ? enemyAnimMachine : playerAnimMachine;

        // Attacker bounces off the guard, stunned — a clear punish window.
        attackerRef.current = false;
        attackerAnim.transitionHit(AnimState.HitHeavy, 'front');
        attackerCtrl.applyStagger(0.7, 0.2);
        // Defender flashes the guard but keeps their footing.
        defenderAnim.transition(AnimState.BlockHit, true);

        combatAudio.playParry();
        screenFx.onCriticalHit();
        battleCamera.shake(0.22, 30);
        battleCamera.punch(0.08);
        particles.emitSparks(event.hitPosition, event.knockbackDir, 1);
        crowd.cheer(0.85);
        combatAudio.crowdCheer(0.85);

        hitStopTimerRef.current = Math.max(hitStopTimerRef.current, 0.1);
        playerAnimMachine.pause();
        enemyAnimMachine.pause();
        return;
      }

      combatAudio.onDamageEvent(event);
      // Camera kick scaled to hit weight, fired on the exact contact frame
      // (this handler runs the instant damage lands). Every hit kicks; heavies
      // and specials kick harder, crits harder still.
      const weight = event.hitType === 'light' ? 1 : event.hitType === 'heavy' ? 2.2 : 3.2;
      battleCamera.shake(0.09 * weight * (event.critical ? 1.4 : 1), 32);
      battleCamera.punch(0.035 * weight);

      // Contact-point VFX + squash-punch on the struck fighter. Both fire at the
      // exact hit instant (event carries the true fist/weapon position).
      const defender = event.defenderId === 'enemy' ? enemyController : playerController;
      if (event.blocked) {
        particles.emitSparks(event.hitPosition, event.knockbackDir, 0.4);
        defender.state.impactPulse = 0.5;
        crowd.boo(0.4);
        combatAudio.crowdBoo(0.4);
      } else if (event.killed) {
        particles.emitKillBurst(event.hitPosition, CLASS_ACCENTS[event.attackerId] ?? '#ffffff');
        particles.emitImpact(event.hitPosition, event.knockbackDir, event.hitType);
        defender.state.impactPulse = 1;
        crowd.roar();
        combatAudio.crowdCheer(1);
      } else {
        particles.emitImpact(event.hitPosition, event.knockbackDir, event.hitType);
        defender.state.impactPulse = event.hitType === 'light' ? 0.7 : 1;
        // Big blows pop the crowd; light taps stir a low murmur.
        const hype = event.hitType === 'light' ? 0.3 : event.hitType === 'heavy' ? 0.6 : 0.9;
        crowd.cheer(hype);
        if (event.hitType !== 'light') combatAudio.crowdCheer(hype);
      }

      if (event.killed) {
        const killColor = CLASS_ACCENTS[event.attackerId] ?? '#ffffff';
        screenFx.onKill(killColor);
      } else if (event.hitType === 'light') {
        screenFx.onLightHit();
      } else if (event.hitType === 'heavy') {
        screenFx.onHeavyHit();
        if (event.critical) screenFx.onCriticalHit();
      } else {
        screenFx.onSpecialHit();
      }
      if (event.blocked) {
        screenFx.onBlock();
        const defenderAnim = event.defenderId === 'enemy' ? enemyAnimMachine : playerAnimMachine;
        defenderAnim.transition(AnimState.BlockHit, true);
      }

      // Hit-stop: set timer, frame loop counts it down
      const hitStopDur = event.killed
        ? HITSTOP_DURATION.kill
        : HITSTOP_DURATION[event.hitType] ?? 0.05;
      hitStopTimerRef.current = Math.max(hitStopTimerRef.current, hitStopDur);
      playerAnimMachine.pause();
      enemyAnimMachine.pause();

      // Combo escalation audio
      if (!event.blocked) {
        comboSystem.registerHit(
          event.attackerId,
          event.hitType === 'light' ? MoveType.LightAttack : event.hitType === 'heavy' ? MoveType.HeavyAttack : MoveType.Special,
        );
        const comboState = comboSystem.getState(event.attackerId);
        onComboUpdate?.(comboState ?? null);

        if (comboState && comboState.count >= 3 && comboState.count % 5 === 0) {
          combatAudio.playComboMilestone(comboState.count);
        }

        // Combo launcher — the deeper the chain, the harder the knockback, so a
        // string ends on a satisfying pop (MK-style finisher feel).
        const comboCount = comboState?.count ?? 1;
        const comboPush = 1 + Math.min(comboCount, 8) * 0.12;
        knockback.applyKnockback(event.defenderId, {
          direction: event.knockbackDir,
          force: event.knockbackForce * comboPush,
          hitType: event.hitType,
          killed: event.killed,
        });
        if (comboCount >= 4) {
          // A landed combo finisher kicks the camera a touch extra.
          battleCamera.punch(0.05);
        }

        // Reaction tier — the victim always reacts, never eats a hit standing.
        // A special or a deep combo finisher knocks them DOWN (fall → get up);
        // heavy staggers; light flinches. Knockdowns can't be teched.
        const defenderCtrl = event.defenderId === 'enemy' ? enemyController : playerController;
        const defenderAnim = event.defenderId === 'enemy' ? enemyAnimMachine : playerAnimMachine;
        const dir = hitDirection(defenderCtrl, event.knockbackDir);
        const knockdown = event.hitType === 'special' || comboCount >= 5;

        if (knockdown) {
          defenderAnim.transition(AnimState.Knockdown, true);
          defenderCtrl.applyStagger(1.5, 0); // long, untechable — they're on the floor
        } else {
          const hitAnim = event.hitType === 'heavy' ? AnimState.HitHeavy : AnimState.HitLight;
          defenderAnim.transitionHit(hitAnim, dir);
          defenderCtrl.applyStagger(STAGGER_DURATION[event.hitType] ?? 0.3);
        }

        if (event.defenderId === 'enemy') {
          enemyAttackingRef.current = false;
        } else {
          playerAttackingRef.current = false;
          comboSystem.drop('player');
          onComboUpdate?.(null);
        }
      }

      if (event.killed && !battleEndedRef.current) {
        battleEndedRef.current = true;
        combatActiveRef.current = false;
        const winner = event.defenderId === 'enemy' ? 'player' : 'enemy';
        if (event.defenderId === 'enemy') {
          enemyAnimMachine.transition(AnimState.Death, true);
        } else {
          playerAnimMachine.transition(AnimState.Death, true);
        }
        combatAudio.stopAll();
        const durationSecs = combatStartRef.current
          ? (performance.now() - combatStartRef.current) / 1000
          : 0;
        setTimeout(() => {
          if (winner === 'player') combatAudio.playVictoryFanfare();
          else combatAudio.playDefeatMelody();
          onBattleEnd?.(winner, durationSecs);
        }, 1500);
      }
    });
  }, [damageSystem, comboSystem, knockback, playerController, enemyController,
    battleCamera, combatAudio, particles, crowd, screenFx, playerAnimMachine, enemyAnimMachine,
    playerClass, enemyClass, onDamageEvent, onComboUpdate, onBattleEnd]);

  // Is the fighter's current attack cancellable right now? Lets buffered inputs
  // chain into a string instead of waiting for the whole clip to finish (the
  // stiffness fix). A confirmed hit opens the window early (from the active
  // frames — snappy hit-confirm); a whiff only cancels in recovery, so whiffing
  // stays punishable. Returns true when not mid-attack so callers can `||` it.
  const canCancelAttack = useCallback((who: 'player' | 'enemy'): boolean => {
    const anim = who === 'player' ? playerAnimMachine : enemyAnimMachine;
    const typeRef = who === 'player' ? playerAttackTypeRef : enemyAttackTypeRef;
    const consumed = who === 'player' ? playerHitConsumed : enemyHitConsumed;
    const classId = who === 'player' ? playerClass : enemyClass;

    const attackState = typeRef.current;
    if (anim.state !== attackState) return true; // clip already ended / moved on
    const fdState = attackState === AnimState.JumpAttack ? AnimState.HeavyAttack : attackState;
    const fd = CLASS_FRAME_DATA[classId]?.[fdState];
    const progress = anim.getActiveProgress();
    if (!fd) return progress > 0.5;
    const total = fd.startup + fd.active + fd.recovery;
    const activeStart = fd.startup / total;
    const recoveryStart = (fd.startup + fd.active) / total;
    return consumed.current.size > 0 ? progress >= activeStart : progress >= recoveryStart;
  }, [playerAnimMachine, enemyAnimMachine, playerClass, enemyClass]);

  const doAttack = useCallback((
    who: 'player' | 'enemy',
    animState: AnimState,
    isCancel = false,
  ) => {
    const ctrl = who === 'player' ? playerController : enemyController;
    const anim = who === 'player' ? playerAnimMachine : enemyAnimMachine;
    const attackRef = who === 'player' ? playerAttackingRef : enemyAttackingRef;
    const consumed = who === 'player' ? playerHitConsumed : enemyHitConsumed;
    const typeRef = who === 'player' ? playerAttackTypeRef : enemyAttackTypeRef;

    const s = ctrl.state;
    if (s.isDodging || s.isStaggered || s.isDead) return;
    // Mid-attack: only proceed if this is a legal cancel into the next move.
    if (s.isAttacking && !isCancel) return;

    // Attacking while airborne becomes a diving jump-attack.
    const airborne = !s.isGrounded;
    const move = airborne ? AnimState.JumpAttack : animState;

    if (who === 'player') {
      const cost = move === AnimState.LightAttack ? 5 : move === AnimState.Special ? 30 : 15;
      if (!damageSystem.hasStamina('player', cost)) return;
      damageSystem.consumeStamina('player', cost);
    }

    s.isAttacking = true;
    attackRef.current = true;
    consumed.current.clear();
    typeRef.current = move;

    // Track the cancel string: extend it on a cancel, restart it on a fresh attack.
    const chainRef = who === 'player' ? playerChainRef : enemyChainRef;
    const chainMove = ANIM_TO_MOVE[move];
    if (isCancel && chainMove) chainRef.current = [...chainRef.current, chainMove];
    else chainRef.current = chainMove ? [chainMove] : [];

    anim.transition(move, true);
    combatAudio.playSwing(who === 'player' ? playerClass : enemyClass);

    // Committed step into the strike — front-loaded then plants (no slide).
    const target = who === 'player' ? enemyController : playerController;
    const lungeDir = new THREE.Vector3()
      .subVectors(target.state.position, ctrl.state.position)
      .setY(0)
      .normalize();
    const dist = ctrl.state.position.distanceTo(target.state.position);
    const stepInto = move === AnimState.LightAttack ? 0.5 : move === AnimState.HeavyAttack ? 0.95 : 1.3;
    const gap = Math.max(0, dist - 1.1); // stop just short of overlapping the target
    ctrl.applyLunge(lungeDir, Math.min(stepInto, gap));
    // A jump-attack dives down toward the target.
    if (airborne) s.velocity.y = Math.min(s.velocity.y, -3);

    // Start weapon trail. The attack now ends when its animation completes
    // (state machine auto-transitions to Idle on the clip's finished event),
    // detected in the frame loop — no setTimeout, so it can never desync from
    // the visible swing or the hitstop freeze.
    const trail = who === 'player' ? playerTrail : enemyTrail;
    trail.start();
  }, [playerController, enemyController, playerAnimMachine, enemyAnimMachine,
    damageSystem, combatAudio, playerClass, enemyClass]);

  const frameCountRef = useRef(0);

  useFrame((_, dt) => {
    const clampedDt = Math.min(dt, 0.05);
    frameCountRef.current++;

    // Always update trails + particles + crowd (they live on through hit-stop)
    playerTrail.update(clampedDt, camera.position);
    enemyTrail.update(clampedDt, camera.position);
    particles.update(clampedDt);
    crowd.update(clampedDt);
    combatAudio.setCrowdEnergy(crowd.energy);

    if (battleEndedRef.current) return;

    // Hit-stop: freeze game logic but keep VFX + camera alive
    if (hitStopTimerRef.current > 0) {
      hitStopTimerRef.current -= clampedDt;
      screenFx.update(clampedDt);
      battleCamera.update(clampedDt, playerController.state.position, enemyController.state.position);
      if (hitStopTimerRef.current <= 0) {
        playerAnimMachine.resume();
        enemyAnimMachine.resume();
      }
      return;
    }

    if (frameCountRef.current % 180 === 1) {
      const ps = playerController.state;
      const es = enemyController.state;
      const dist = ps.position.distanceTo(es.position);
      console.log(`[F${frameCountRef.current}] P:${ps.health}hp atk=${ps.isAttacking} stag=${ps.isStaggered} | E:${es.health}hp atk=${es.isAttacking} | dist=${dist.toFixed(1)} | AI=${enemyAI.currentState}`);
    }

    // --- Wait for combat to start ---
    const ps = playerController.state;
    if (!combatActiveRef.current) {
      battleCamera.update(clampedDt, ps.position, enemyController.state.position);
      input.update();
      return;
    }

    // --- Start background music + crowd ambience on first combat frame ---
    if (!bgmStartedRef.current) {
      bgmStartedRef.current = true;
      combatStartRef.current = performance.now();
      combatAudio.startBGM();
      combatAudio.startCrowdAmbience();
    }

    // --- Player input ---
    const move = input.moveAxis;
    const isMoving = Math.abs(move.x) > 0.1 || Math.abs(move.y) > 0.1;

    if (!ps.isDead) {
      playerController.update(clampedDt, input, battleCamera.cameraYaw);
    }

    // On the frame the fighter leaves stagger (recovered or teched), force the
    // transition so the non-interruptible hit clip is cut immediately.
    const playerJustRecovered = playerWasStaggered.current && !ps.isStaggered;
    playerWasStaggered.current = ps.isStaggered;

    if (!ps.isDead && !ps.isStaggered && !ps.isAttacking) {
      const f = playerJustRecovered;
      if (ps.isDodging) {
        playerAnimMachine.transition(AnimState.Dodge, f);
      } else if (!ps.isGrounded) {
        playerAnimMachine.transition(AnimState.Jump, f);
      } else if (ps.isBlocking) {
        playerAnimMachine.transition(AnimState.Block, f);
      } else if (isMoving) {
        playerAnimMachine.transition(ps.isRunning ? AnimState.Run : AnimState.Walk, f);
      } else {
        playerAnimMachine.transition(AnimState.Idle, f);
      }
    }

    // Buffered attacks fire when free, or chain mid-swing inside a cancel window.
    // A fresh attack (not attacking) can be any opener; a cancel must continue one
    // of this class's combo routes, so strings are class-flavored not any-into-any.
    // Only consume the buffer when we can actually act, so a press made a few frames
    // early is held until the cancel opens instead of being dropped.
    const pAttacking = playerAttackingRef.current;
    if (!pAttacking || canCancelAttack('player')) {
      const onRoute = (mv: MoveType) =>
        !pAttacking || canGatlingCancel(playerClass, playerChainRef.current, mv);
      if (onRoute(MoveType.LightAttack) && input.consumeBuffered(Action.LightAttack)) {
        doAttack('player', AnimState.LightAttack, pAttacking);
      } else if (onRoute(MoveType.HeavyAttack) && input.consumeBuffered(Action.HeavyAttack)) {
        doAttack('player', AnimState.HeavyAttack, pAttacking);
      } else if (onRoute(MoveType.Special) && input.consumeBuffered(Action.Special)) {
        doAttack('player', AnimState.Special, pAttacking);
      }
    }

    // --- Enemy AI ---
    if (!enemyController.state.isDead) {
      const aiInput = enemyAI.getInput();
      aiInput.update();
      enemyAI.update(clampedDt, enemyController, playerController);
      enemyController.update(clampedDt, aiInput, 0);

      if (!enemyAttackingRef.current) {
        // Fresh attack: the AI's telegraph→attack presses an action this frame.
        if (aiInput.getAction(Action.LightAttack).held) doAttack('enemy', AnimState.LightAttack);
        else if (aiInput.getAction(Action.HeavyAttack).held) doAttack('enemy', AnimState.HeavyAttack);
        else if (aiInput.getAction(Action.Special).held) doAttack('enemy', AnimState.Special);
      } else if (canCancelAttack('enemy')) {
        // Mid-swing in a cancel window: chain into the AI's next queued follow-up
        // (same mechanic the player gets). The new attack resets progress, so this
        // self-paces to one cancel per swing rather than dumping the whole string.
        const next = enemyAI.takeFollowUp();
        const anim = next ? AI_ATTACK_ANIM[next] : undefined;
        if (anim) doAttack('enemy', anim, true);
      }

      const es = enemyController.state;
      const enemyJustRecovered = enemyWasStaggered.current && !es.isStaggered;
      enemyWasStaggered.current = es.isStaggered;

      if (!es.isStaggered && !es.isAttacking && !es.isDead) {
        const f = enemyJustRecovered;
        if (es.isDodging) {
          enemyAnimMachine.transition(AnimState.Dodge, f);
        } else if (!es.isGrounded) {
          enemyAnimMachine.transition(AnimState.Jump, f);
        } else if (es.isBlocking) {
          enemyAnimMachine.transition(AnimState.Block, f);
        } else {
          const aiMove = aiInput.moveAxis;
          if (Math.abs(aiMove.x) > 0.1 || Math.abs(aiMove.y) > 0.1) {
            enemyAnimMachine.transition(es.isRunning ? AnimState.Run : AnimState.Walk, f);
          } else {
            enemyAnimMachine.transition(AnimState.Idle, f);
          }
        }
      }
    }

    // --- Body separation — keep fighters from overlapping/clipping ---
    playerController.separateFrom(enemyController, FIGHTER_SEPARATION);

    // --- Hit detection (animation-clocked) ---
    // Damage is gated by the attack animation's own normalized progress, so the
    // hitbox goes live exactly when the visible swing reaches its contact frames
    // — and freezes with it during hitstop. The attack ends when its clip
    // finishes (state machine auto-transitions away), not on a wall-clock timer.
    const resolveAttack = (
      attackerId: 'player' | 'enemy',
      defenderId: 'player' | 'enemy',
      attacker: CharacterController,
      defender: CharacterController,
      anim: AnimationStateMachine,
      attackingRef: MutableRefObject<boolean>,
      typeRef: MutableRefObject<AnimState>,
      consumed: MutableRefObject<Set<number>>,
      classId: ClassId,
      trail: TrailRenderer,
    ) => {
      if (!attackingRef.current) return;
      const attackState = typeRef.current;

      // Still mid-swing: check the live hitbox windows against the animation clock.
      if (anim.state === attackState) {
        // Jump-attack borrows the heavy hitbox/move for damage.
        const fdState = attackState === AnimState.JumpAttack ? AnimState.HeavyAttack : attackState;
        const fd = CLASS_FRAME_DATA[classId]?.[fdState];
        const moveType = ANIM_TO_MOVE[attackState];
        const move = moveType ? getMoveForAction(classId, moveType) : undefined;
        if (fd && move) {
          const progress = anim.getActiveProgress();
          fd.hitboxes.forEach((hb, i) => {
            if (consumed.current.has(i)) return;
            const win = getHitboxWindow(fd, hb);
            if (progress < win.start || progress > win.end) return;
            if (hitboxHits(hb, attacker.state.position, attacker.state.rotation, defender.state.position)) {
              consumed.current.add(i);
              const contact = hitboxContactPoint(hb, attacker.state.position, attacker.state.rotation);
              damageSystem.calculateAndApply(attackerId, defenderId, attacker, defender, hb, move, contact);
            }
          });
        }
        return;
      }

      // Clip finished (auto-returned to Idle) or was interrupted → release control.
      attackingRef.current = false;
      attacker.state.isAttacking = false;
      trail.stop();
    };

    resolveAttack('player', 'enemy', playerController, enemyController, playerAnimMachine,
      playerAttackingRef, playerAttackTypeRef, playerHitConsumed, playerClass, playerTrail);
    resolveAttack('enemy', 'player', enemyController, playerController, enemyAnimMachine,
      enemyAttackingRef, enemyAttackTypeRef, enemyHitConsumed, enemyClass, enemyTrail);

    // --- Systems ---
    knockback.update(clampedDt, 'player', playerController);
    knockback.update(clampedDt, 'enemy', enemyController);
    damageSystem.updateStamina(clampedDt);
    comboSystem.update(clampedDt);
    screenFx.update(clampedDt);
    battleCamera.update(clampedDt, ps.position, enemyController.state.position);

    // --- Weapon trail points — trace the swing arc (driven by the attack
    // animation clock): the strike point sweeps across and out, arcing down. ---
    const emitTrail = (
      ctrl: CharacterController,
      anim: AnimationStateMachine,
      attacking: boolean,
      trail: TrailRenderer,
    ) => {
      if (!attacking) return;
      const progress = anim.getActiveProgress();
      if (progress < 0.08 || progress > 0.82) return; // crisp arc, skip wind-up/recovery
      const s = ctrl.state;
      const sin = Math.sin(s.rotation), cos = Math.cos(s.rotation);
      const reach = 0.7 + progress * 0.7;        // extends through the swing
      const sweep = (progress - 0.45) * 1.6;     // lateral arc across the body
      const h = 1.45 - progress * 0.5;           // arcs downward
      const p = s.position.clone();
      p.x += sin * reach + cos * sweep * 0.8;
      p.z += cos * reach - sin * sweep * 0.8;
      p.y += h;
      trail.addPoint(p);
    };
    emitTrail(playerController, playerAnimMachine, playerAttackingRef.current, playerTrail);
    emitTrail(enemyController, enemyAnimMachine, enemyAttackingRef.current, enemyTrail);

    // --- Footsteps + ground dust ---
    const playerSpeed = Math.sqrt(ps.velocity.x ** 2 + ps.velocity.z ** 2);
    if (playerSpeed > FOOTSTEP_SPEED_THRESHOLD && !ps.isAttacking && !ps.isStaggered && !ps.isDead) {
      playerStepTimerRef.current -= clampedDt;
      if (playerStepTimerRef.current <= 0) {
        playerStepTimerRef.current = FOOTSTEP_INTERVAL;
        combatAudio.playFootstep();
      }
    } else {
      playerStepTimerRef.current = 0;
    }

    const es = enemyController.state;
    const enemySpeed = Math.sqrt(es.velocity.x ** 2 + es.velocity.z ** 2);
    if (enemySpeed > FOOTSTEP_SPEED_THRESHOLD && !es.isAttacking && !es.isStaggered && !es.isDead) {
      enemyStepTimerRef.current -= clampedDt;
      if (enemyStepTimerRef.current <= 0) {
        enemyStepTimerRef.current = FOOTSTEP_INTERVAL;
        combatAudio.playFootstep(0.15);
      }
    } else {
      enemyStepTimerRef.current = 0;
    }

    const playerStats = damageSystem.getStats('player');
    onPlayerStateUpdate?.(ps.health, ps.maxHealth, playerStats?.stamina ?? 100, playerStats?.staminaMax ?? 100);
    onEnemyStateUpdate?.(enemyController.state.health, enemyController.state.maxHealth);

    input.update();
  });

  return (
    <>
      <StageLighting stageId={stageId} />
      <AmbientVFX stageId={stageId} />
      <ArenaStage stageId={stageId} />
      <Crowd director={crowd} />
      <FighterModel classId={playerClass} state={playerController.state} animMachine={playerAnimMachine} accent={CLASS_ACCENTS[playerClass]} />
      <FighterModel classId={enemyClass} state={enemyController.state} animMachine={enemyAnimMachine} accent={CLASS_ACCENTS[enemyClass]} />
      <primitive object={playerTrail.object3d} />
      <primitive object={enemyTrail.object3d} />
      <primitive object={particles.mesh} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
    </>
  );
}

function LoadingScreen() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#333" wireframe />
    </mesh>
  );
}

export function GameScene(props: GameSceneProps) {
  const [playerHP, setPlayerHP] = useState(100);
  const [playerMaxHP, setPlayerMaxHP] = useState(100);
  const [playerStamina, setPlayerStamina] = useState(100);
  const [playerStaminaMax, setPlayerStaminaMax] = useState(100);
  const [enemyHP, setEnemyHP] = useState(100);
  const [enemyMaxHP, setEnemyMaxHP] = useState(100);
  const [combo, setCombo] = useState<ComboState | null>(null);
  const [battleResult, setBattleResult] = useState<'player' | 'enemy' | null>(null);
  const [countdown, setCountdown] = useState<number | 'FIGHT' | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const combatStartedRef = useRef(false);

  const difficulty = props.difficulty ?? AIDifficulty.Medium;
  const inputAttached = useRef(false);
  const screenFx = useMemo(() => new ScreenEffects(), []);

  useEffect(() => {
    if (inputAttached.current) return;
    inputAttached.current = true;
    const input = getInputSystem();
    input.attach(window);
  }, []);

  const startCountdown = useCallback(() => {
    if (combatStartedRef.current) return;
    setSceneReady(true);
    setCountdown(3);
    setTimeout(() => setCountdown(2), 1000);
    setTimeout(() => setCountdown(1), 2000);
    setTimeout(() => {
      setCountdown('FIGHT');
      combatStartedRef.current = true;
    }, 3000);
    setTimeout(() => setCountdown(null), 3800);
  }, []);

  return (
    <div className="w-full h-full relative" tabIndex={0}>
      <Canvas
        shadows
        camera={{ fov: 50, near: 0.1, far: 200, position: [0, 3, 8] }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.6 }}
        className="w-full h-full"
      >
        <color attach="background" args={['#12111a']} />
        <fog attach="fog" args={['#12111a', 25, 60]} />
        <Suspense fallback={<LoadingScreen />}>
          <BattleWorld
            {...props}
            difficulty={difficulty}
            combatActive={combatStartedRef.current}
            screenFx={screenFx}
            onDamageEvent={props.onDamageEvent}
            onComboUpdate={setCombo}
            onPlayerStateUpdate={(h, mh, s, sm) => { setPlayerHP(h); setPlayerMaxHP(mh); setPlayerStamina(s); setPlayerStaminaMax(sm); }}
            onEnemyStateUpdate={(h, mh) => { setEnemyHP(h); setEnemyMaxHP(mh); }}
            onBattleEnd={(w, d) => { setBattleResult(w); props.onBattleEnd?.(w, d); }}
            onReady={startCountdown}
          />
        </Suspense>
      </Canvas>

      <ScreenFlashOverlay screenEffects={screenFx} />

      {/* HUD */}
      <div className="fixed inset-0 pointer-events-none z-30">
        <div className="absolute top-4 left-4 md:top-6 md:left-6">
          <div className="text-xs font-bold uppercase tracking-wider text-white/80 mb-1">{props.playerClass}</div>
          <div className="relative w-48 md:w-64 h-4 rounded-sm overflow-hidden bg-black/60 border border-white/10">
            <div className="absolute inset-y-0 left-0 rounded-sm transition-all duration-300" style={{
              width: `${Math.max(0, (playerHP / playerMaxHP) * 100)}%`,
              backgroundColor: playerHP < 25 ? '#ef4444' : CLASS_ACCENTS[props.playerClass],
            }} />
          </div>
          <div className="text-xs text-white/50 font-mono mt-0.5">{playerHP}/{playerMaxHP}</div>
          <div className="w-32 md:w-48 h-2 rounded-full overflow-hidden bg-black/40 border border-white/5 mt-1">
            <div className="h-full rounded-full transition-all duration-150" style={{
              width: `${(playerStamina / playerStaminaMax) * 100}%`,
              backgroundColor: playerStamina < 20 ? '#f59e0b' : '#22c55e',
            }} />
          </div>
        </div>
        <div className="absolute top-4 right-4 md:top-6 md:right-6 text-right">
          <div className="text-xs font-bold uppercase tracking-wider text-white/80 mb-1">{props.enemyName ?? props.enemyClass}</div>
          <div className="relative w-48 md:w-64 h-4 rounded-sm overflow-hidden bg-black/60 border border-white/10">
            <div className="absolute inset-y-0 right-0 rounded-sm transition-all duration-300" style={{
              width: `${Math.max(0, (enemyHP / enemyMaxHP) * 100)}%`,
              backgroundColor: enemyHP < 25 ? '#ef4444' : CLASS_ACCENTS[props.enemyClass],
            }} />
          </div>
          <div className="text-xs text-white/50 font-mono mt-0.5">{enemyHP}/{enemyMaxHP}</div>
        </div>
        {combo && combo.count >= 2 && (
          <div className="absolute top-1/3 right-8 text-center">
            <div className="text-4xl font-black text-yellow-400">{combo.count}</div>
            <div className="text-sm font-bold uppercase text-yellow-300/80">HIT COMBO</div>
          </div>
        )}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 hidden md:flex gap-3">
          {[
            { key: 'WASD', label: 'Move' },
            { key: 'J', label: 'Light', color: '#ff6644' },
            { key: 'K', label: 'Heavy', color: '#ff8800' },
            { key: 'L', label: 'Special', color: '#aa44ff' },
            { key: '⇧', label: 'Block', color: '#4488ff' },
            { key: '␣', label: 'Dodge', color: '#22cc66' },
          ].map(({ key, label, color }) => (
            <div key={key} className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 rounded-lg border flex items-center justify-center text-xs font-mono font-bold bg-black/60"
                style={{ borderColor: color ?? '#555', color: color ?? '#aaa' }}>{key}</div>
              <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Countdown overlay */}
      {countdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            {typeof countdown === 'number' ? (
              <div className="text-8xl md:text-9xl font-black text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)] animate-pulse">
                {countdown}
              </div>
            ) : (
              <div className="text-7xl md:text-8xl font-black text-yellow-400 drop-shadow-[0_0_40px_rgba(250,204,21,0.6)]">
                FIGHT!
              </div>
            )}
          </div>
        </div>
      )}

      {/* VS intro before countdown */}
      {!sceneReady && !battleResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="text-center">
            <div className="text-2xl md:text-3xl font-black text-white/80 mb-2">Loading Arena...</div>
            <div className="w-32 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
              <div className="h-full bg-white/50 rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        </div>
      )}

      {battleResult && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 pointer-events-auto">
          <h1 className="text-5xl md:text-7xl font-black" style={{ color: battleResult === 'player' ? CLASS_ACCENTS[props.playerClass] : '#ef4444' }}>
            {battleResult === 'player' ? 'VICTORY' : 'DEFEATED'}
          </h1>
          <p className="text-white/50 mt-3 text-lg">
            {battleResult === 'player' ? 'Enemy has been slain' : `Slain by ${props.enemyName ?? props.enemyClass}`}
          </p>

          {/* Server-authoritative rewards for this fight */}
          {props.rewardPending && (
            <div className="mt-5 text-sm text-white/50 animate-pulse">Recording result…</div>
          )}
          {props.reward && (
            <div className="mt-5 flex flex-col items-center gap-1.5">
              <div className="text-2xl font-black text-green-400">+{props.reward.xpAwarded} XP</div>
              {props.reward.rankedUp && props.reward.newRank && (
                <div className="text-lg font-black uppercase tracking-wide text-yellow-400 drop-shadow-[0_0_12px_rgba(250,204,21,0.5)]">
                  Rank Up → {props.reward.newRank}
                </div>
              )}
              {props.reward.gAwarded > 0 && (
                <div className="text-lg font-bold text-emerald-300">+{props.reward.gAwarded} G$</div>
              )}
            </div>
          )}

          <button onClick={() => window.location.reload()} className="mt-8 px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg transition-colors">
            {battleResult === 'player' ? 'FIGHT AGAIN' : 'RETRY'}
          </button>
        </div>
      )}

      <TouchControls />
    </div>
  );
}
