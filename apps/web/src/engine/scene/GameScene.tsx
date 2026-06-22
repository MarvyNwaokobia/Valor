'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FighterModel } from './FighterModel';
import { ArenaStage, type StageId } from './ArenaStage';
import { BattleCamera } from '../camera';
import { CharacterController } from '../character';
import { AnimationStateMachine, AnimState, CLASS_ANIMATIONS } from '../animation';
import { Action, getInputSystem } from '../input';
import { TouchControls } from '../input/TouchControls';
import { CLASS_FRAME_DATA } from '../combat/HitboxSystem';
import { DamageSystem, type DamageEvent } from '../combat/DamageSystem';
import { ComboSystem, type ComboState, MoveType } from '../combat';
import { EnemyAI, AIDifficulty } from '../combat/EnemyAI';
import { ParticleSystem } from '../vfx/ParticleSystem';
import { KnockbackPhysics } from '../vfx/KnockbackPhysics';
import { TrailRenderer } from '../vfx/TrailRenderer';
import { CombatAudio } from '../audio/CombatAudio';
import { ScreenEffects } from '../vfx/ScreenEffects';
import { CombatPostProcessing } from '../vfx/PostProcessing';
import { ScreenFlashOverlay } from '../vfx/ScreenFlashOverlay';
import { StageLighting } from '../world/StageLighting';
import { AmbientVFX } from '../world/AmbientVFX';

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
  onBattleEnd?: (winner: 'player' | 'enemy') => void;
}

const CLASS_ACCENTS: Record<string, string> = {
  berserker: '#ff4422',
  sentinel: '#4488ff',
  phantom: '#aa44ff',
};

const ATTACK_DURATION_MS: Record<string, number> = {
  [AnimState.LightAttack]: 600,
  [AnimState.HeavyAttack]: 900,
  [AnimState.Special]: 1200,
};

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

  const activateCombat = useCallback(() => {
    combatActiveRef.current = true;
    console.log('[BattleWorld] Combat activated!');
  }, []);

  const input = useMemo(() => getInputSystem(), []);
  const battleCamera = useMemo(() => new BattleCamera(perspCamera), [perspCamera]);

  const playerController = useMemo(() => new CharacterController(new THREE.Vector3(-1.5, 0, 0)), []);
  const enemyController = useMemo(() => new CharacterController(new THREE.Vector3(1.5, 0, 0)), []);

  const playerAnimMachine = useMemo(() => new AnimationStateMachine(CLASS_ANIMATIONS[playerClass]), [playerClass]);
  const enemyAnimMachine = useMemo(() => new AnimationStateMachine(CLASS_ANIMATIONS[enemyClass]), [enemyClass]);

  const damageSystem = useMemo(() => new DamageSystem(), []);
  const comboSystem = useMemo(() => new ComboSystem(), []);
  const enemyAI = useMemo(() => new EnemyAI(difficulty), [difficulty]);
  const particles = useMemo(() => new ParticleSystem(), []);
  const knockback = useMemo(() => new KnockbackPhysics(), []);
  const combatAudio = useMemo(() => new CombatAudio(), []);

  const playerAttackingRef = useRef(false);
  const enemyAttackingRef = useRef(false);
  const attackFrameRef = useRef(0);
  const enemyAttackFrameRef = useRef(0);
  const playerAttackTypeRef = useRef<AnimState>(AnimState.LightAttack);
  const enemyAttackTypeRef = useRef<AnimState>(AnimState.LightAttack);

  // Hit-stop
  const hitStopTimerRef = useRef(0);

  // Weapon trails
  const playerTrail = useMemo(() => new TrailRenderer(CLASS_ACCENTS[playerClass], 20, 0.12, 0.35), [playerClass]);
  const enemyTrail = useMemo(() => new TrailRenderer(CLASS_ACCENTS[enemyClass], 20, 0.12, 0.35), [enemyClass]);

  // Footstep timer
  const playerStepTimerRef = useRef(0);
  const enemyStepTimerRef = useRef(0);

  // Background music
  const bgmStartedRef = useRef(false);

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
      combatAudio.onDamageEvent(event);
      particles.emitImpact(event.hitPosition, event.knockbackDir, event.hitType);
      battleCamera.shake(event.hitType === 'light' ? 0.1 : event.hitType === 'heavy' ? 0.25 : 0.4, 30);
      if (event.hitType !== 'light') {
        battleCamera.punch(event.hitType === 'heavy' ? 0.06 : 0.1);
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
      if (event.blocked) screenFx.onBlock();

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
          performance.now()
        );
        const comboState = comboSystem.getState(event.attackerId);
        onComboUpdate?.(comboState ?? null);

        if (comboState && comboState.count >= 3 && comboState.count % 5 === 0) {
          combatAudio.playComboMilestone(comboState.count);
        }

        knockback.applyKnockback(event.defenderId, {
          direction: event.knockbackDir,
          force: event.knockbackForce,
          hitType: event.hitType,
          killed: event.killed,
        });

        // Variable hit-stun based on attack type
        const staggerMs = (STAGGER_DURATION[event.hitType] ?? 0.3) * 1000;
        const hitAnim = event.hitType === 'light' ? AnimState.HitLight : AnimState.HitHeavy;

        if (event.defenderId === 'enemy') {
          enemyAnimMachine.transition(hitAnim, true);
          enemyController.state.isStaggered = true;
          enemyAttackingRef.current = false;
          setTimeout(() => {
            enemyController.clearStagger();
            if (!enemyController.state.isDead) enemyAnimMachine.transition(AnimState.Idle, true);
          }, staggerMs);
        } else {
          playerAnimMachine.transition(hitAnim, true);
          playerController.state.isStaggered = true;
          playerController.state.isAttacking = false;
          playerAttackingRef.current = false;
          comboSystem.drop('player');
          onComboUpdate?.(null);
          setTimeout(() => {
            playerController.clearStagger();
            if (!playerController.state.isDead) playerAnimMachine.transition(AnimState.Idle, true);
          }, staggerMs);
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
        particles.emitKillBurst(event.hitPosition, CLASS_ACCENTS[winner === 'player' ? playerClass : enemyClass]);
        combatAudio.stopAll();
        setTimeout(() => {
          if (winner === 'player') combatAudio.playVictoryFanfare();
          else combatAudio.playDefeatMelody();
          onBattleEnd?.(winner);
        }, 1500);
      }
    });
  }, [damageSystem, comboSystem, knockback, playerController, enemyController,
    battleCamera, particles, combatAudio, screenFx, playerAnimMachine, enemyAnimMachine,
    playerClass, enemyClass, onDamageEvent, onComboUpdate, onBattleEnd]);

  const doAttack = useCallback((
    who: 'player' | 'enemy',
    animState: AnimState,
  ) => {
    const ctrl = who === 'player' ? playerController : enemyController;
    const anim = who === 'player' ? playerAnimMachine : enemyAnimMachine;
    const attackRef = who === 'player' ? playerAttackingRef : enemyAttackingRef;
    const frameRef = who === 'player' ? attackFrameRef : enemyAttackFrameRef;
    const typeRef = who === 'player' ? playerAttackTypeRef : enemyAttackTypeRef;

    const s = ctrl.state;
    if (s.isAttacking || s.isDodging || s.isStaggered || s.isDead) return;

    if (who === 'player') {
      const cost = animState === AnimState.LightAttack ? 5 : animState === AnimState.HeavyAttack ? 15 : 30;
      if (!damageSystem.hasStamina('player', cost)) return;
      damageSystem.consumeStamina('player', cost);
    }

    s.isAttacking = true;
    attackRef.current = true;
    frameRef.current = 0;
    typeRef.current = animState;
    anim.transition(animState, true);
    combatAudio.playSwing(who === 'player' ? playerClass : enemyClass);

    // Attack lunge — surge toward opponent
    const target = who === 'player' ? enemyController : playerController;
    const lungeDir = new THREE.Vector3()
      .subVectors(target.state.position, ctrl.state.position)
      .setY(0)
      .normalize();
    const dist = ctrl.state.position.distanceTo(target.state.position);
    const lungeForce = animState === AnimState.LightAttack ? 4 : animState === AnimState.HeavyAttack ? 6 : 8;
    const lungeDist = Math.max(0, dist - 1.2);
    const clampedLunge = Math.min(lungeForce, lungeDist * 3);
    ctrl.state.velocity.addScaledVector(lungeDir, clampedLunge);

    // Start weapon trail
    const trail = who === 'player' ? playerTrail : enemyTrail;
    trail.start();

    const duration = ATTACK_DURATION_MS[animState] ?? 600;
    setTimeout(() => {
      s.isAttacking = false;
      attackRef.current = false;
      trail.stop();
      if (!s.isDead && !s.isStaggered) {
        anim.transition(AnimState.Idle, true);
      }
    }, duration);
  }, [playerController, enemyController, playerAnimMachine, enemyAnimMachine,
    damageSystem, combatAudio, playerClass, enemyClass]);

  const frameCountRef = useRef(0);

  useFrame((_, dt) => {
    const clampedDt = Math.min(dt, 0.05);
    frameCountRef.current++;

    // Always update trails (they fade even during hit-stop)
    playerTrail.update(clampedDt, camera.position);
    enemyTrail.update(clampedDt, camera.position);

    if (battleEndedRef.current) return;

    // Hit-stop: freeze game logic but keep VFX + camera alive
    if (hitStopTimerRef.current > 0) {
      hitStopTimerRef.current -= clampedDt;
      particles.update(clampedDt);
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

    // --- Start background music on first combat frame ---
    if (!bgmStartedRef.current) {
      bgmStartedRef.current = true;
      combatAudio.startBGM();
    }

    // --- Player input ---
    const move = input.moveAxis;
    const isMoving = Math.abs(move.x) > 0.1 || Math.abs(move.y) > 0.1;

    if (!ps.isDead) {
      playerController.update(clampedDt, input, battleCamera.cameraYaw);
    }

    if (!ps.isDead && !ps.isStaggered && !ps.isAttacking) {
      if (ps.isBlocking) {
        playerAnimMachine.transition(AnimState.Block);
      } else if (isMoving) {
        playerAnimMachine.transition(AnimState.Walk);
      } else {
        playerAnimMachine.transition(AnimState.Idle);
      }
    }

    if (input.consumeBuffered(Action.LightAttack)) doAttack('player', AnimState.LightAttack);
    if (input.consumeBuffered(Action.HeavyAttack)) doAttack('player', AnimState.HeavyAttack);
    if (input.consumeBuffered(Action.Special)) doAttack('player', AnimState.Special);

    // --- Enemy AI ---
    if (!enemyController.state.isDead) {
      const aiInput = enemyAI.getInput();
      aiInput.update();
      enemyAI.update(clampedDt, enemyController, playerController);
      enemyController.update(clampedDt, aiInput, 0);

      if (aiInput.getAction(Action.LightAttack).held) doAttack('enemy', AnimState.LightAttack);
      if (aiInput.getAction(Action.HeavyAttack).held) doAttack('enemy', AnimState.HeavyAttack);
      if (aiInput.getAction(Action.Special).held) doAttack('enemy', AnimState.Special);

      const es = enemyController.state;
      if (!es.isStaggered && !es.isAttacking && !es.isDead) {
        const aiMove = aiInput.moveAxis;
        if (Math.abs(aiMove.x) > 0.1 || Math.abs(aiMove.y) > 0.1) {
          enemyAnimMachine.transition(AnimState.Walk);
        } else {
          enemyAnimMachine.transition(AnimState.Idle);
        }
      }
    }

    // --- Hit detection ---
    if (playerAttackingRef.current) {
      attackFrameRef.current++;
      const fd = CLASS_FRAME_DATA[playerClass]?.[playerAttackTypeRef.current];
      if (fd) {
        for (const hb of fd.hitboxes) {
          if (attackFrameRef.current >= hb.startFrame && attackFrameRef.current <= hb.endFrame) {
            const dist = ps.position.distanceTo(enemyController.state.position);
            if (dist <= hb.offset.z + hb.radius + 0.5) {
              const key = `p_${attackFrameRef.current}`;
              if (!(damageSystem as any)[key]) {
                (damageSystem as any)[key] = true;
                damageSystem.calculateAndApply('player', 'enemy', playerController, enemyController, hb, { blockable: playerAttackTypeRef.current !== AnimState.Special });
                setTimeout(() => delete (damageSystem as any)[key], 1000);
              }
            }
          }
        }
      }
    }

    if (enemyAttackingRef.current) {
      enemyAttackFrameRef.current++;
      const fd = CLASS_FRAME_DATA[enemyClass]?.[enemyAttackTypeRef.current];
      if (fd) {
        for (const hb of fd.hitboxes) {
          if (enemyAttackFrameRef.current >= hb.startFrame && enemyAttackFrameRef.current <= hb.endFrame) {
            const dist = enemyController.state.position.distanceTo(ps.position);
            if (dist <= hb.offset.z + hb.radius + 0.5) {
              const key = `e_${enemyAttackFrameRef.current}`;
              if (!(damageSystem as any)[key]) {
                (damageSystem as any)[key] = true;
                damageSystem.calculateAndApply('enemy', 'player', enemyController, playerController, hb, { blockable: enemyAttackTypeRef.current !== AnimState.Special });
                setTimeout(() => delete (damageSystem as any)[key], 1000);
              }
            }
          }
        }
      }
    }

    // --- Systems ---
    knockback.update(clampedDt, 'player', playerController);
    knockback.update(clampedDt, 'enemy', enemyController);
    damageSystem.updateStamina(clampedDt);
    comboSystem.update(clampedDt);
    particles.update(clampedDt);
    screenFx.update(clampedDt);
    battleCamera.update(clampedDt, ps.position, enemyController.state.position);

    // --- Weapon trail points ---
    if (playerAttackingRef.current) {
      const trailPos = ps.position.clone();
      trailPos.y += 1.2;
      const fwd = new THREE.Vector3(Math.sin(ps.rotation), 0, Math.cos(ps.rotation));
      trailPos.addScaledVector(fwd, 1.0);
      playerTrail.addPoint(trailPos);
    }
    if (enemyAttackingRef.current) {
      const es = enemyController.state;
      const trailPos = es.position.clone();
      trailPos.y += 1.2;
      const fwd = new THREE.Vector3(Math.sin(es.rotation), 0, Math.cos(es.rotation));
      trailPos.addScaledVector(fwd, 1.0);
      enemyTrail.addPoint(trailPos);
    }

    // --- Footsteps + ground dust ---
    const playerSpeed = Math.sqrt(ps.velocity.x ** 2 + ps.velocity.z ** 2);
    if (playerSpeed > FOOTSTEP_SPEED_THRESHOLD && !ps.isAttacking && !ps.isStaggered && !ps.isDead) {
      playerStepTimerRef.current -= clampedDt;
      if (playerStepTimerRef.current <= 0) {
        playerStepTimerRef.current = FOOTSTEP_INTERVAL;
        combatAudio.playFootstep();
        particles.emitDust(ps.position, 0.2);
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
        particles.emitDust(es.position, 0.15);
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
      <FighterModel classId={playerClass} state={playerController.state} animMachine={playerAnimMachine} accent={CLASS_ACCENTS[playerClass]} />
      <FighterModel classId={enemyClass} state={enemyController.state} animMachine={enemyAnimMachine} accent={CLASS_ACCENTS[enemyClass]} />
      <primitive object={particles.mesh} />
      <primitive object={playerTrail.object3d} />
      <primitive object={enemyTrail.object3d} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
      <CombatPostProcessing screenEffects={screenFx} />
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
  const battleWorldRef = useRef<{ startCombat: () => void }>();

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
            onBattleEnd={(w) => { setBattleResult(w); props.onBattleEnd?.(w); }}
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
          <button onClick={() => window.location.reload()} className="mt-8 px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg transition-colors">
            {battleResult === 'player' ? 'FIGHT AGAIN' : 'RETRY'}
          </button>
        </div>
      )}

      <TouchControls />
    </div>
  );
}
