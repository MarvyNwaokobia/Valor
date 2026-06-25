'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FighterModel } from './FighterModel';
import { ArenaStage, type StageId } from './ArenaStage';
import { BattleCamera } from '../camera';
import type { CharacterController } from '../character';
import { AnimationStateMachine, AnimState, CLASS_ANIMATIONS } from '../animation';
import { getInputSystem } from '../input';
import { TouchControls } from '../input/TouchControls';
import type { DamageEvent } from '../combat/DamageSystem';
import type { ComboState } from '../combat';
import { AIDifficulty } from '../combat/EnemyAI';
import { CombatSim, type FighterId, type SimEvent } from '../sim/CombatSim';
import { ParticleSystem } from '../vfx/ParticleSystem';
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

const HITSTOP_DURATION: Record<string, number> = {
  light: 0.05,
  heavy: 0.1,
  special: 0.15,
  kill: 0.35,
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

  const input = useMemo(() => getInputSystem(), []);
  const battleCamera = useMemo(() => new BattleCamera(perspCamera), [perspCamera]);

  // The one authoritative combat sim (the same render-free core a server runs).
  // In PvE the enemy (p2) is AI-driven inside the sim; the local player drives p1.
  const sim = useMemo(() => {
    const s = new CombatSim(playerClass, enemyClass);
    s.attachAI('p2', difficulty);
    return s;
  }, [playerClass, enemyClass, difficulty]);
  const playerController = sim.controller('p1');
  const enemyController = sim.controller('p2');

  const playerAnimMachine = useMemo(() => new AnimationStateMachine(CLASS_ANIMATIONS[playerClass]), [playerClass]);
  const enemyAnimMachine = useMemo(() => new AnimationStateMachine(CLASS_ANIMATIONS[enemyClass]), [enemyClass]);

  const combatAudio = useMemo(() => new CombatAudio(), []);
  const particles = useMemo(() => new ParticleSystem(), []);
  const crowd = useMemo(() => new CrowdDirector(), []);

  // Hit-stop
  const hitStopTimerRef = useRef(0);

  // Weapon trails
  const playerTrail = useMemo(() => new TrailRenderer(CLASS_ACCENTS[playerClass], 24, 0.18, 0.42), [playerClass]);
  const enemyTrail = useMemo(() => new TrailRenderer(CLASS_ACCENTS[enemyClass], 24, 0.18, 0.42), [enemyClass]);

  // Footstep timer
  const playerStepTimerRef = useRef(0);
  const enemyStepTimerRef = useRef(0);

  // Background music
  const bgmStartedRef = useRef(false);
  // Wall-clock start of live combat, for the fight-duration reward guard.
  const combatStartRef = useRef(0);

  // The sim wires lock-on between fighters; here we just lock the camera onto the duel.
  useEffect(() => {
    battleCamera.setLockedOn(true);
  }, [battleCamera]);

  const animFor = useCallback(
    (id: FighterId) => (id === 'p1' ? playerAnimMachine : enemyAnimMachine),
    [playerAnimMachine, enemyAnimMachine],
  );

  // Render one authoritative hit into client feedback — animation clips, VFX,
  // audio, camera kicks, hit-stop, HUD. The sim already applied the *gameplay*
  // (damage, knockback, stagger, combo, KO); this only shows its consequences.
  const processHit = useCallback((e: Extract<SimEvent, { kind: 'hit' }>) => {
    const ev = e.event;
    onDamageEvent?.(ev);
    const attackerId = ev.attackerId as FighterId;
    const defenderId = ev.defenderId as FighterId;
    const attackerClass = attackerId === 'p1' ? playerClass : enemyClass;
    const defenderAnim = animFor(defenderId);
    const defenderCtrl = sim.controller(defenderId);

    // Parry — the defender caught it clean; the sim stunned the attacker.
    if (ev.parried) {
      animFor(attackerId).transitionHit(AnimState.HitHeavy, 'front');
      defenderAnim.transition(AnimState.BlockHit, true);
      combatAudio.playParry();
      screenFx.onCriticalHit();
      battleCamera.shake(0.22, 30);
      battleCamera.punch(0.08);
      particles.emitSparks(ev.hitPosition, ev.knockbackDir, 1);
      crowd.cheer(0.85);
      combatAudio.crowdCheer(0.85);
      hitStopTimerRef.current = Math.max(hitStopTimerRef.current, 0.1);
      playerAnimMachine.pause();
      enemyAnimMachine.pause();
      return;
    }

    combatAudio.onDamageEvent(ev);
    // Camera kick scaled to hit weight, on the exact contact frame.
    const weight = ev.hitType === 'light' ? 1 : ev.hitType === 'heavy' ? 2.2 : 3.2;
    battleCamera.shake(0.09 * weight * (ev.critical ? 1.4 : 1), 32);
    battleCamera.punch(0.035 * weight);

    // Contact-point VFX + squash-punch on the struck fighter.
    if (ev.blocked) {
      particles.emitSparks(ev.hitPosition, ev.knockbackDir, 0.4);
      defenderCtrl.state.impactPulse = 0.5;
      crowd.boo(0.4);
      combatAudio.crowdBoo(0.4);
      screenFx.onBlock();
      defenderAnim.transition(AnimState.BlockHit, true);
    } else if (ev.killed) {
      particles.emitKillBurst(ev.hitPosition, CLASS_ACCENTS[attackerClass] ?? '#ffffff');
      particles.emitImpact(ev.hitPosition, ev.knockbackDir, ev.hitType);
      defenderCtrl.state.impactPulse = 1;
      crowd.roar();
      combatAudio.crowdCheer(1);
      screenFx.onKill(CLASS_ACCENTS[attackerClass] ?? '#ffffff');
    } else {
      particles.emitImpact(ev.hitPosition, ev.knockbackDir, ev.hitType);
      defenderCtrl.state.impactPulse = ev.hitType === 'light' ? 0.7 : 1;
      const hype = ev.hitType === 'light' ? 0.3 : ev.hitType === 'heavy' ? 0.6 : 0.9;
      crowd.cheer(hype);
      if (ev.hitType !== 'light') combatAudio.crowdCheer(hype);
      if (ev.hitType === 'light') screenFx.onLightHit();
      else if (ev.hitType === 'heavy') { screenFx.onHeavyHit(); if (ev.critical) screenFx.onCriticalHit(); }
      else screenFx.onSpecialHit();
    }

    // Hit-reaction clip (the sim already applied the stagger/knockdown state),
    // plus combo HUD/audio.
    if (!ev.blocked) {
      const knockdown = ev.hitType === 'special' || e.comboCount >= 5;
      if (knockdown) defenderAnim.transition(AnimState.Knockdown, true);
      else defenderAnim.transitionHit(ev.hitType === 'heavy' ? AnimState.HitHeavy : AnimState.HitLight, e.direction);

      const combo = sim.comboState(attackerId);
      if (combo && combo.count >= 3 && combo.count % 5 === 0) combatAudio.playComboMilestone(combo.count);
      if (e.comboCount >= 4) battleCamera.punch(0.05);
      // The player combo HUD reflects the player's own string; clears if the player is hit.
      onComboUpdate?.(defenderId === 'p1' ? null : sim.comboState('p1') ?? null);
    }

    // Hit-stop — freeze the sim + anim for a beat (the loop counts it down).
    const hitStopDur = ev.killed ? HITSTOP_DURATION.kill : HITSTOP_DURATION[ev.hitType] ?? 0.05;
    hitStopTimerRef.current = Math.max(hitStopTimerRef.current, hitStopDur);
    playerAnimMachine.pause();
    enemyAnimMachine.pause();
  }, [sim, animFor, playerAnimMachine, enemyAnimMachine, combatAudio, particles, crowd,
    screenFx, battleCamera, onDamageEvent, onComboUpdate, playerClass, enemyClass]);

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

    // --- Advance Simulation Headless ---
    const events = sim.step(clampedDt, { p1: input }, { p1: battleCamera.cameraYaw });

    // --- Process Simulation Events ---
    events.forEach((e) => {
      if (e.kind === 'attackStart') {
        const who = e.fighter;
        const animMachine = who === 'p1' ? playerAnimMachine : enemyAnimMachine;
        // `e.chain` (this attack was a cancel) advances the combo-clip variety;
        // a fresh press plays the base clip so single-taps read consistently.
        animMachine.transition(e.anim, true, undefined, e.chain);
        combatAudio.playSwing(who === 'p1' ? playerClass : enemyClass);
        
        // Start weapon trail
        const trail = who === 'p1' ? playerTrail : enemyTrail;
        trail.start();
      } else if (e.kind === 'hit') {
        processHit(e);
      } else if (e.kind === 'ko') {
        if (!battleEndedRef.current) {
          battleEndedRef.current = true;
          combatActiveRef.current = false;
          combatAudio.stopAll();
          
          const winner = e.winner === 'p1' ? 'player' : 'enemy';
          const loser = e.loser === 'p1' ? 'player' : 'enemy';
          
          // Trigger death animation
          const loserAnim = loser === 'player' ? playerAnimMachine : enemyAnimMachine;
          loserAnim.transition(AnimState.Death, true);
          
          const durationSecs = combatStartRef.current
            ? (performance.now() - combatStartRef.current) / 1000
            : 0;
            
          setTimeout(() => {
            if (winner === 'player') combatAudio.playVictoryFanfare();
            else combatAudio.playDefeatMelody();
            onBattleEnd?.(winner, durationSecs);
          }, 1500);
        }
      }
    });

    // --- Synchronise Animation States Frame-by-Frame ---
    const snapshot = sim.snapshot();
    playerAnimMachine.transition(snapshot.fighters.p1.animState);
    enemyAnimMachine.transition(snapshot.fighters.p2.animState);

    // --- Weapon trail points ---
    const emitTrail = (
      id: FighterId,
      ctrl: CharacterController,
      trail: TrailRenderer,
    ) => {
      const attacking = ctrl.state.isAttacking;
      if (!attacking) return;
      const progress = sim.attackProgress(id);
      if (progress < 0.08 || progress > 0.82) return; // skip wind-up / recovery
      const s = ctrl.state;
      const sin = Math.sin(s.rotation), cos = Math.cos(s.rotation);
      const reach = 0.7 + progress * 0.7;
      const sweep = (progress - 0.45) * 1.6;
      const h = 1.45 - progress * 0.5;
      const p = s.position.clone();
      p.x += sin * reach + cos * sweep * 0.8;
      p.z += cos * reach - sin * sweep * 0.8;
      p.y += h;
      trail.addPoint(p);
    };
    emitTrail('p1', playerController, playerTrail);
    emitTrail('p2', enemyController, enemyTrail);

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

    // --- Update HUD Stats ---
    const playerStats = sim.damage.getStats('p1');
    onPlayerStateUpdate?.(ps.health, ps.maxHealth, playerStats?.stamina ?? 100, playerStats?.staminaMax ?? 100);
    onEnemyStateUpdate?.(enemyController.state.health, enemyController.state.maxHealth);
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
