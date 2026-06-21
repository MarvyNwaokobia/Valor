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
import { HitboxSystem, CLASS_FRAME_DATA, type FrameData } from '../combat/HitboxSystem';
import { DamageSystem, type DamageEvent } from '../combat/DamageSystem';
import { ComboSystem, type ComboState, MoveType } from '../combat';
import { EnemyAI, AIDifficulty } from '../combat/EnemyAI';
import { ScreenEffects } from '../vfx/ScreenEffects';
import { ParticleSystem } from '../vfx/ParticleSystem';
import { KnockbackPhysics } from '../vfx/KnockbackPhysics';
import { CombatAudio } from '../audio/CombatAudio';
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
}: GameSceneProps & { difficulty: AIDifficulty }) {
  const { camera } = useThree();
  const perspCamera = camera as THREE.PerspectiveCamera;
  const battleEndedRef = useRef(false);

  const input = useMemo(() => getInputSystem(), []);

  useEffect(() => {
    const cleanup = input.attach(window);
    console.log('[GameScene] Keyboard input attached');
    return cleanup;
  }, [input]);

  const battleCamera = useMemo(() => new BattleCamera(perspCamera), [perspCamera]);

  const playerController = useMemo(
    () => new CharacterController(new THREE.Vector3(-3, 0, 0)),
    []
  );
  const enemyController = useMemo(
    () => new CharacterController(new THREE.Vector3(3, 0, 0)),
    []
  );

  const playerAnimMachine = useMemo(
    () => new AnimationStateMachine(CLASS_ANIMATIONS[playerClass]),
    [playerClass]
  );
  const enemyAnimMachine = useMemo(
    () => new AnimationStateMachine(CLASS_ANIMATIONS[enemyClass]),
    [enemyClass]
  );

  const hitboxSystem = useMemo(() => new HitboxSystem(), []);
  const damageSystem = useMemo(() => new DamageSystem(), []);
  const comboSystem = useMemo(() => new ComboSystem(), []);
  const enemyAI = useMemo(() => new EnemyAI(difficulty), [difficulty]);
  const screenFx = useMemo(() => new ScreenEffects(), []);
  const particles = useMemo(() => new ParticleSystem(), []);
  const knockback = useMemo(() => new KnockbackPhysics(), []);
  const combatAudio = useMemo(() => new CombatAudio(), []);

  const playerAttackingRef = useRef<AnimState | null>(null);
  const enemyAttackingRef = useRef<AnimState | null>(null);
  const attackFrameRef = useRef(0);
  const enemyAttackFrameRef = useRef(0);

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

      if (event.blocked) {
        screenFx.onBlock();
        combatAudio.onDamageEvent(event);
        particles.emitSparks(event.hitPosition, event.knockbackDir, 0.3);
        battleCamera.shake(0.05, 40, 0.08);
      } else {
        switch (event.hitType) {
          case 'light':
            screenFx.onLightHit();
            battleCamera.shake(0.08, 35, 0.12);
            break;
          case 'heavy':
            screenFx.onHeavyHit();
            battleCamera.shake(0.2, 28, 0.2);
            battleCamera.punch(1.06, 0.35);
            break;
          case 'special':
            screenFx.onSpecialHit();
            battleCamera.shake(0.35, 22, 0.3);
            battleCamera.punch(1.1, 0.5);
            break;
        }

        if (event.critical) {
          screenFx.onCriticalHit();
          battleCamera.shake(0.35, 25, 0.3);
        }

        combatAudio.onDamageEvent(event);
        particles.emitImpact(event.hitPosition, event.knockbackDir, event.hitType);

        knockback.applyKnockback(event.defenderId, {
          direction: event.knockbackDir,
          force: event.knockbackForce,
          hitType: event.hitType,
          killed: event.killed,
        });

        const comboResult = comboSystem.registerHit(
          event.attackerId,
          event.hitType === 'light' ? MoveType.LightAttack :
          event.hitType === 'heavy' ? MoveType.HeavyAttack : MoveType.Special,
          performance.now()
        );
        onComboUpdate?.(comboSystem.getState(event.attackerId) ?? null);

        if (comboResult.comboCount >= 2) {
          combatAudio.playComboHit(comboResult.comboCount);
        }

        if (event.defenderId === 'enemy') {
          enemyAnimMachine.transition(
            event.hitType === 'light' ? AnimState.HitLight : AnimState.HitHeavy,
            true
          );
          enemyController.state.isStaggered = true;
          enemyAttackingRef.current = null;
          setTimeout(() => {
            if (!enemyController.state.isDead) {
              enemyController.clearStagger();
              enemyAnimMachine.transition(AnimState.Idle, true);
            }
          }, event.hitStun * 1000);
        } else {
          playerAnimMachine.transition(
            event.hitType === 'light' ? AnimState.HitLight : AnimState.HitHeavy,
            true
          );
          playerController.state.isStaggered = true;
          playerController.state.isAttacking = false;
          playerAttackingRef.current = null;
          comboSystem.drop('player');
          onComboUpdate?.(null);
          setTimeout(() => {
            if (!playerController.state.isDead) {
              playerController.clearStagger();
              playerAnimMachine.transition(AnimState.Idle, true);
            }
          }, event.hitStun * 1000);
        }
      }

      if (event.killed) {
        const color = CLASS_ACCENTS[event.attackerId === 'player' ? playerClass : enemyClass];
        screenFx.onKill(color);
        particles.emitKillBurst(event.hitPosition, color);
        battleCamera.shake(0.5, 18, 0.5);
        battleCamera.punch(1.15, 0.8);
        combatAudio.onDamageEvent(event);

        if (event.defenderId === 'enemy') {
          enemyAnimMachine.transition(AnimState.Death, true);
        } else {
          playerAnimMachine.transition(AnimState.Death, true);
        }

        if (!battleEndedRef.current) {
          battleEndedRef.current = true;
          const winner = event.defenderId === 'enemy' ? 'player' : 'enemy';
          setTimeout(() => {
            if (winner === 'player') {
              combatAudio.playVictoryFanfare();
              playerAnimMachine.transition(AnimState.Victory, true);
            } else {
              combatAudio.playDefeatMelody();
            }
            onBattleEnd?.(winner);
          }, 1500);
        }
      }
    });
  }, [
    damageSystem, comboSystem, knockback, playerController, enemyController,
    battleCamera, screenFx, particles, combatAudio, playerAnimMachine,
    enemyAnimMachine, playerClass, enemyClass, onDamageEvent, onComboUpdate, onBattleEnd,
  ]);

  const startPlayerAttack = useCallback((animState: AnimState) => {
    const ps = playerController.state;
    if (ps.isAttacking || ps.isDodging || ps.isStaggered || ps.isDead) return;

    const staminaCost = animState === AnimState.LightAttack ? 5 :
                        animState === AnimState.HeavyAttack ? 15 : 30;
    if (!damageSystem.hasStamina('player', staminaCost)) return;
    damageSystem.consumeStamina('player', staminaCost);

    ps.isAttacking = true;
    playerAttackingRef.current = animState;
    attackFrameRef.current = 0;
    hitboxSystem.resetForAttack('player');
    playerAnimMachine.transition(animState, true);
    combatAudio.playSwing(playerClass);

    playerAnimMachine.setOnStateChange((_from, to) => {
      if (to === AnimState.Idle) {
        ps.isAttacking = false;
        playerAttackingRef.current = null;
      }
    });
  }, [playerController, damageSystem, hitboxSystem, playerAnimMachine, combatAudio, playerClass]);

  const startEnemyAttack = useCallback((animState: AnimState) => {
    const es = enemyController.state;
    if (es.isAttacking || es.isDodging || es.isStaggered || es.isDead) return;

    es.isAttacking = true;
    enemyAttackingRef.current = animState;
    enemyAttackFrameRef.current = 0;
    hitboxSystem.resetForAttack('enemy');
    enemyAnimMachine.transition(animState, true);
    combatAudio.playSwing(enemyClass);

    enemyAnimMachine.setOnStateChange((_from, to) => {
      if (to === AnimState.Idle) {
        es.isAttacking = false;
        enemyAttackingRef.current = null;
      }
    });
  }, [enemyController, hitboxSystem, enemyAnimMachine, combatAudio, enemyClass]);

  const frameCountRef = useRef(0);

  useFrame((_, dt) => {
    const clampedDt = Math.min(dt, 0.05);
    frameCountRef.current++;
    if (battleEndedRef.current && playerController.state.isDead && enemyController.state.isDead) return;

    if (frameCountRef.current % 120 === 1) {
      const ps = playerController.state;
      const es = enemyController.state;
      const dist = ps.position.distanceTo(es.position);
      console.log(`[F${frameCountRef.current}] P:${ps.health}hp pos(${ps.position.x.toFixed(1)},${ps.position.z.toFixed(1)}) atk=${ps.isAttacking} | E:${es.health}hp pos(${es.position.x.toFixed(1)},${es.position.z.toFixed(1)}) atk=${es.isAttacking} | dist=${dist.toFixed(1)} | AI=${enemyAI.currentState}`);
    }

    // --- Input ---
    const lockOn = input.getAction(Action.LockOn);
    if (lockOn.justPressed) battleCamera.toggleLockOn();
    const look = input.lookDelta;
    battleCamera.rotateMouse(look.x, look.y);

    // --- Player movement + state ---
    if (!playerController.state.isDead) {
      playerController.update(clampedDt, input, battleCamera.cameraYaw);
    }

    const move = input.moveAxis;
    const isMoving = Math.abs(move.x) > 0.1 || Math.abs(move.y) > 0.1;
    const ps = playerController.state;

    if (!ps.isDead && !ps.isStaggered && !ps.isAttacking) {
      if (ps.isDodging) {
        playerAnimMachine.transition(AnimState.Dodge);
      } else if (ps.isBlocking) {
        playerAnimMachine.transition(AnimState.Block);
      } else if (isMoving) {
        playerAnimMachine.transition(AnimState.Walk);
      } else {
        playerAnimMachine.transition(AnimState.Idle);
      }
    }

    // --- Player attacks ---
    const lightAtk = input.getAction(Action.LightAttack);
    const heavyAtk = input.getAction(Action.HeavyAttack);
    const special = input.getAction(Action.Special);

    if (lightAtk.justPressed) startPlayerAttack(AnimState.LightAttack);
    if (heavyAtk.justPressed) startPlayerAttack(AnimState.HeavyAttack);
    if (special.justPressed) startPlayerAttack(AnimState.Special);

    // --- Enemy AI ---
    if (!enemyController.state.isDead) {
      const aiInput = enemyAI.getInput();
      aiInput.update();
      enemyAI.update(clampedDt, enemyController, playerController);
      enemyController.update(clampedDt, aiInput, 0);

      const es = enemyController.state;
      const aiLightAtk = aiInput.getAction(Action.LightAttack);
      const aiHeavyAtk = aiInput.getAction(Action.HeavyAttack);
      const aiSpecial = aiInput.getAction(Action.Special);

      if (aiLightAtk.held && !es.isAttacking) startEnemyAttack(AnimState.LightAttack);
      if (aiHeavyAtk.held && !es.isAttacking) startEnemyAttack(AnimState.HeavyAttack);
      if (aiSpecial.held && !es.isAttacking) startEnemyAttack(AnimState.Special);

      if (!es.isStaggered && !es.isAttacking && !es.isDead) {
        const aiMove = aiInput.moveAxis;
        const aiMoving = Math.abs(aiMove.x) > 0.1 || Math.abs(aiMove.y) > 0.1;
        if (es.isDodging) {
          enemyAnimMachine.transition(AnimState.Dodge);
        } else if (es.isBlocking) {
          enemyAnimMachine.transition(AnimState.Block);
        } else if (aiMoving) {
          enemyAnimMachine.transition(AnimState.Walk);
        } else {
          enemyAnimMachine.transition(AnimState.Idle);
        }
      }
    }

    // --- Hitbox detection (simplified: direct distance + frame check) ---
    const checkAttackHit = (
      attackerId: string,
      defenderId: string,
      attackerCtrl: typeof playerController,
      defenderCtrl: typeof enemyController,
      attackAnim: AnimState | null,
      frameCount: number,
    ) => {
      if (!attackAnim) return;
      const frameData = CLASS_FRAME_DATA['berserker']?.[attackAnim];
      if (!frameData) return;

      for (const hb of frameData.hitboxes) {
        if (frameCount >= hb.startFrame && frameCount <= hb.endFrame) {
          const dist = attackerCtrl.state.position.distanceTo(defenderCtrl.state.position);
          const reach = hb.offset.z + hb.radius + 0.5;
          if (dist <= reach) {
            const hitKey = `${attackerId}_${defenderId}_${frameCount}`;
            if ((hitboxSystem as any)._usedKeys?.has(hitKey)) return;
            if (!(hitboxSystem as any)._usedKeys) (hitboxSystem as any)._usedKeys = new Set();
            (hitboxSystem as any)._usedKeys.add(hitKey);

            damageSystem.calculateAndApply(
              attackerId, defenderId,
              attackerCtrl, defenderCtrl,
              hb,
              { blockable: attackAnim !== AnimState.Special }
            );
            return;
          }
        }
      }
    };

    if (playerAttackingRef.current) {
      attackFrameRef.current++;
      checkAttackHit('player', 'enemy', playerController, enemyController, playerAttackingRef.current, attackFrameRef.current);
    }

    if (enemyAttackingRef.current) {
      enemyAttackFrameRef.current++;
      checkAttackHit('enemy', 'player', enemyController, playerController, enemyAttackingRef.current, enemyAttackFrameRef.current);
    }

    // --- Knockback physics ---
    knockback.update(clampedDt, 'player', playerController);
    knockback.update(clampedDt, 'enemy', enemyController);

    // --- Stamina regen ---
    damageSystem.updateStamina(clampedDt);

    // --- Combo decay ---
    comboSystem.update(clampedDt);

    // --- VFX ---
    screenFx.update(clampedDt);
    particles.update(clampedDt);

    // --- Camera ---
    battleCamera.update(
      clampedDt,
      playerController.state.position,
      enemyController.state.position
    );

    // --- UI callbacks ---
    const playerStats = damageSystem.getStats('player');
    onPlayerStateUpdate?.(ps.health, ps.maxHealth, playerStats?.stamina ?? 100, playerStats?.staminaMax ?? 100);
    onEnemyStateUpdate?.(enemyController.state.health, enemyController.state.maxHealth);

    // --- Low HP effects ---
    if (ps.health < 25 && ps.health > 0) {
      screenFx.onLowHealth();
    }

    input.update();
  });

  return (
    <>
      <StageLighting stageId={stageId} />
      <AmbientVFX stageId={stageId} />
      <ArenaStage stageId={stageId} />

      <FighterModel
        classId={playerClass}
        state={playerController.state}
        animMachine={playerAnimMachine}
        accent={CLASS_ACCENTS[playerClass]}
      />
      <FighterModel
        classId={enemyClass}
        state={enemyController.state}
        animMachine={enemyAnimMachine}
        accent={CLASS_ACCENTS[enemyClass]}
      />

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
  const [lastDamage, setLastDamage] = useState<DamageEvent | null>(null);

  const difficulty = props.difficulty ?? AIDifficulty.Medium;

  return (
    <div className="w-full h-full relative">
      <Canvas
        shadows
        camera={{ fov: 50, near: 0.1, far: 200, position: [0, 3, 8] }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.6,
        }}
        className="w-full h-full"
      >
        <color attach="background" args={['#12111a']} />
        <fog attach="fog" args={['#12111a', 25, 60]} />
        <Suspense fallback={<LoadingScreen />}>
          <BattleWorld
            {...props}
            difficulty={difficulty}
            onDamageEvent={(e) => { setLastDamage(e); props.onDamageEvent?.(e); }}
            onComboUpdate={setCombo}
            onPlayerStateUpdate={(h, mh, s, sm) => { setPlayerHP(h); setPlayerMaxHP(mh); setPlayerStamina(s); setPlayerStaminaMax(sm); }}
            onEnemyStateUpdate={(h, mh) => { setEnemyHP(h); setEnemyMaxHP(mh); }}
            onBattleEnd={(w) => { setBattleResult(w); props.onBattleEnd?.(w); }}
          />
        </Suspense>
      </Canvas>

      {/* HUD Overlay */}
      <div className="fixed inset-0 pointer-events-none z-30">
        {/* Player HP — top left */}
        <div className="absolute top-4 left-4 md:top-6 md:left-6">
          <div className="text-xs font-bold uppercase tracking-wider text-white/80 mb-1">
            {props.playerClass}
          </div>
          <div className="relative w-48 md:w-64 h-4 rounded-sm overflow-hidden bg-black/60 border border-white/10">
            <div
              className="absolute inset-y-0 left-0 rounded-sm transition-all duration-300"
              style={{
                width: `${Math.max(0, (playerHP / playerMaxHP) * 100)}%`,
                backgroundColor: playerHP < 10 ? '#ef4444' : playerHP < 25 ? '#f59e0b' : CLASS_ACCENTS[props.playerClass],
                boxShadow: playerHP < 25 ? `0 0 8px ${playerHP < 10 ? '#ef4444' : '#f59e0b'}` : 'none',
              }}
            />
            {playerHP < 10 && (
              <div className="absolute inset-0 rounded-sm bg-red-500/20 animate-pulse" />
            )}
          </div>
          <div className="text-xs text-white/50 font-mono mt-0.5">{playerHP}/{playerMaxHP}</div>
          {/* Stamina */}
          <div className="w-32 md:w-48 h-2 rounded-full overflow-hidden bg-black/40 border border-white/5 mt-1">
            <div
              className="h-full rounded-full transition-all duration-150"
              style={{
                width: `${(playerStamina / playerStaminaMax) * 100}%`,
                backgroundColor: playerStamina < 20 ? '#f59e0b' : '#22c55e',
              }}
            />
          </div>
        </div>

        {/* Enemy HP — top right */}
        <div className="absolute top-4 right-4 md:top-6 md:right-6 text-right">
          <div className="text-xs font-bold uppercase tracking-wider text-white/80 mb-1">
            {props.enemyName ?? props.enemyClass}
          </div>
          <div className="relative w-48 md:w-64 h-4 rounded-sm overflow-hidden bg-black/60 border border-white/10">
            <div
              className="absolute inset-y-0 right-0 rounded-sm transition-all duration-300"
              style={{
                width: `${Math.max(0, (enemyHP / enemyMaxHP) * 100)}%`,
                backgroundColor: enemyHP < 10 ? '#ef4444' : enemyHP < 25 ? '#f59e0b' : CLASS_ACCENTS[props.enemyClass],
              }}
            />
          </div>
          <div className="text-xs text-white/50 font-mono mt-0.5">{enemyHP}/{enemyMaxHP}</div>
        </div>

        {/* Combo counter */}
        {combo && combo.count >= 2 && (
          <div className="absolute top-1/3 right-8 md:right-16 text-center">
            <div className={`font-black text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)] ${
              combo.count >= 10 ? 'text-5xl' : combo.count >= 5 ? 'text-4xl' : 'text-3xl'
            }`}>
              {combo.count}
            </div>
            <div className="text-sm font-bold uppercase tracking-widest text-yellow-300/80 mt-1">
              HIT COMBO
            </div>
            {combo.damageMultiplier > 1.1 && (
              <div className="text-xs text-orange-400 mt-0.5">
                ×{combo.damageMultiplier.toFixed(1)} DMG
              </div>
            )}
          </div>
        )}

        {/* Controls hint — desktop */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 hidden md:flex gap-3">
          {[
            { key: 'WASD', label: 'Move' },
            { key: 'J', label: 'Light', color: '#ff6644' },
            { key: 'K', label: 'Heavy', color: '#ff8800' },
            { key: 'L', label: 'Special', color: '#aa44ff' },
            { key: '⇧', label: 'Block', color: '#4488ff' },
            { key: '␣', label: 'Dodge', color: '#22cc66' },
            { key: 'Tab', label: 'Lock', color: '#888' },
          ].map(({ key, label, color }) => (
            <div key={key} className="flex flex-col items-center gap-1">
              <div
                className="w-10 h-10 rounded-lg border flex items-center justify-center text-xs font-mono font-bold bg-black/60"
                style={{ borderColor: color ?? '#555', color: color ?? '#aaa' }}
              >
                {key}
              </div>
              <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Battle result overlay */}
      {battleResult && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 pointer-events-auto">
          <h1
            className="text-5xl md:text-7xl font-black tracking-tight"
            style={{ color: battleResult === 'player' ? CLASS_ACCENTS[props.playerClass] : '#ef4444' }}
          >
            {battleResult === 'player' ? 'VICTORY' : 'DEFEATED'}
          </h1>
          <p className="text-white/50 mt-3 text-lg">
            {battleResult === 'player' ? 'Enemy has been slain' : `Slain by ${props.enemyName ?? props.enemyClass}`}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-8 px-8 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg transition-colors"
          >
            {battleResult === 'player' ? 'FIGHT AGAIN' : 'RETRY'}
          </button>
        </div>
      )}

      {/* Screen flash overlay */}
      <ScreenFlashLayer />

      <TouchControls />
    </div>
  );
}

function ScreenFlashLayer() {
  return null;
}
