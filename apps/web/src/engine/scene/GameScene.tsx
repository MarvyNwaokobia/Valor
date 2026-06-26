'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FighterModel } from './FighterModel';
import { type StageId } from './ArenaStage';
import { StylizedArena } from './arenas/StylizedArena';
import { RealisticArena } from './arenas/RealisticArena';
import { ModelArena } from './arenas/ModelArena';
import { CoverProps } from './arenas/CoverProps';
import { BattleCamera } from '../camera';
import { AnimationStateMachine, AnimState, CLASS_ANIMATIONS } from '../animation';
import { getInputSystem } from '../input';
import { TouchControls } from '../input/TouchControls';
import type { DamageEvent } from '../combat/DamageSystem';
import { type ComboState, STARTER_GUN_ID, type GunId } from '../combat';
import { AIDifficulty } from '../combat';
import { CombatSim, type FighterId, type SimEvent } from '../sim/CombatSim';
import { ParticleSystem } from '../vfx/ParticleSystem';
import { TracerFX } from '../vfx/TracerFX';
import { CombatAudio } from '../audio/CombatAudio';
import { ScreenEffects } from '../vfx/ScreenEffects';
import { ScreenFlashOverlay } from '../vfx/ScreenFlashOverlay';
import { Crowd } from '../world/Crowd';
import { CrowdDirector } from '../world/CrowdDirector';

type ClassId = 'berserker' | 'sentinel' | 'phantom';

// Art directions the player can live-toggle to compare the look (single deploy).
// 'stylized'/'realistic' are procedural; the rest are real downloaded Sketchfab
// fighting-arena models (see ModelArena). The toggle cycles through this order.
export type ArenaVariant = 'stylized' | 'realistic' | 'battle' | 'scifi';

const ARENA_CYCLE: { id: ArenaVariant; label: string }[] = [
  { id: 'stylized', label: 'Stylized' },
  { id: 'realistic', label: 'Semi-Real' },
  { id: 'battle', label: 'Battle · model' },
  { id: 'scifi', label: 'Sci-Fi · model' },
];

interface GameSceneProps {
  playerClass: ClassId;
  enemyClass: ClassId;
  stageId?: StageId;
  enemyName?: string;
  difficulty?: AIDifficulty;
  // Equipped guns (the Campaign level sets the enemy's; defaults to the starter).
  playerGun?: GunId;
  enemyGun?: GunId;
  enemyHpMult?: number; // Campaign level scales the bot's HP (1 = base 100).
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

// Tracer colours so the player can tell their fire from the opponent's at a glance.
const PLAYER_TRACER = 0x66ccff; // cyan
const ENEMY_TRACER = 0xff7744;  // orange

const FOOTSTEP_INTERVAL = 0.3;
const FOOTSTEP_SPEED_THRESHOLD = 1.0;

function BattleWorld({
  playerClass,
  enemyClass,
  difficulty = AIDifficulty.Medium,
  playerGun = STARTER_GUN_ID,
  enemyGun = STARTER_GUN_ID,
  enemyHpMult = 1,
  arenaVariant,
  onDamageEvent,
  onPlayerStateUpdate,
  onEnemyStateUpdate,
  onBattleEnd,
  onReady,
  combatActive = false,
  screenFx,
}: GameSceneProps & { difficulty: AIDifficulty; arenaVariant: ArenaVariant; onReady?: () => void; combatActive?: boolean; screenFx: ScreenEffects }) {
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
    const s = new CombatSim(playerClass, enemyClass, { p1Gun: playerGun, p2Gun: enemyGun, p2HpMult: enemyHpMult });
    s.attachAI('p2', difficulty);
    return s;
  }, [playerClass, enemyClass, difficulty, playerGun, enemyGun, enemyHpMult]);
  const playerController = sim.controller('p1');
  const enemyController = sim.controller('p2');

  const playerAnimMachine = useMemo(() => new AnimationStateMachine(CLASS_ANIMATIONS[playerClass]), [playerClass]);
  const enemyAnimMachine = useMemo(() => new AnimationStateMachine(CLASS_ANIMATIONS[enemyClass]), [enemyClass]);

  const combatAudio = useMemo(() => new CombatAudio(), []);
  const particles = useMemo(() => new ParticleSystem(), []);
  const crowd = useMemo(() => new CrowdDirector(), []);

  // Hit-stop (reserved for the kill freeze only — bullets don't freeze the game)
  const hitStopTimerRef = useRef(0);

  // Gunfire tracers + muzzle flashes, coloured per shooter for readability.
  const tracerFX = useMemo(() => new TracerFX(), []);

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

  // A shot left the muzzle — fire clip + gunshot + tracer/flash, and a small kick
  // on the LOCAL player's own fire only (so the opponent's spray doesn't rattle the
  // camera). The sim authored the shot; this just shows + sounds it.
  const fireFX = useCallback((e: Extract<SimEvent, { kind: 'fire' }>) => {
    const who = e.fighter;
    animFor(who).transition(AnimState.Fire, true);
    combatAudio.playGunshot();

    const origin = new THREE.Vector3(e.origin[0], e.origin[1], e.origin[2]);
    const target = new THREE.Vector3(e.target[0], e.target[1], e.target[2]);
    tracerFX.fire(origin, target, who === 'p1' ? PLAYER_TRACER : ENEMY_TRACER);
    particles.emitEnergy(origin, who === 'p1' ? CLASS_ACCENTS[playerClass] : CLASS_ACCENTS[enemyClass], 0.35);

    if (who === 'p1') {
      battleCamera.shake(0.03, 45);
      battleCamera.punch(0.012);
    }
  }, [animFor, combatAudio, tracerFX, particles, battleCamera, playerClass, enemyClass]);

  // A landed shot — the sim already applied damage/stagger; play the reaction clip
  // and feed the HUD. No per-bullet hit-stop — a firefight has to keep flowing.
  const onHit = useCallback((e: Extract<SimEvent, { kind: 'hit' }>) => {
    const ev = e.event;
    onDamageEvent?.(ev);
    const defenderId = ev.defenderId as FighterId;
    const defenderAnim = animFor(defenderId);
    sim.controller(defenderId).state.impactPulse = ev.hitType === 'light' ? 0.5 : 0.85;

    combatAudio.onDamageEvent(ev);
    if (ev.killed) return; // the KO handler plays the death + ends the match

    defenderAnim.transitionHit(ev.hitType === 'light' ? AnimState.HitLight : AnimState.HitHeavy, e.direction);

    // Only crits/heavies nudge the camera + crowd; light hits stay quiet so a stream
    // of bullets doesn't thrash the screen.
    if (ev.critical || ev.hitType !== 'light') {
      battleCamera.punch(0.02);
      crowd.cheer(ev.hitType === 'special' ? 0.7 : 0.4);
      if (ev.critical) screenFx.onCriticalHit();
    }
  }, [sim, animFor, combatAudio, crowd, screenFx, battleCamera, onDamageEvent]);

  // A projectile arrived — spark on a hit, dust puff on a dodge/whiff.
  const impactFX = useCallback((e: Extract<SimEvent, { kind: 'projectileHit' }>) => {
    const pos = new THREE.Vector3(e.position[0], e.position[1], e.position[2]);
    const dir = new THREE.Vector3().subVectors(pos, sim.controller(e.shooterId).state.position).setY(0).normalize();
    if (e.hit) {
      particles.emitImpact(pos, dir, e.crit ? 'special' : 'light');
      particles.emitSparks(pos, dir, e.crit ? 0.8 : 0.4);
    } else {
      particles.emitDust(pos, 0.3);
    }
  }, [sim, particles]);

  const frameCountRef = useRef(0);

  useFrame((_, dt) => {
    const clampedDt = Math.min(dt, 0.05);
    frameCountRef.current++;

    // VFX live on through hit-stop. screenFx MUST tick every frame: its flashes/tints
    // decay here, and the shooter doesn't use per-hit hit-stop — so if this only ran
    // inside the hit-stop branch (as it once did), the first crit's gold flash would
    // never decay and leave the whole screen washed yellow.
    tracerFX.update(clampedDt);
    particles.update(clampedDt);
    crowd.update(clampedDt);
    combatAudio.setCrowdEnergy(crowd.energy);
    screenFx.update(clampedDt);

    if (battleEndedRef.current) {
      // Keep framing the finish — the lock-on camera follows the bodies through the
      // death/victory beat instead of freezing the instant someone is KO'd.
      battleCamera.update(clampedDt, playerController.state.position, enemyController.state.position);
      return;
    }

    // Hit-stop: freeze game logic but keep VFX + camera alive
    if (hitStopTimerRef.current > 0) {
      hitStopTimerRef.current -= clampedDt;
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
      if (e.kind === 'fire') {
        fireFX(e);
      } else if (e.kind === 'projectileHit') {
        impactFX(e);
      } else if (e.kind === 'hit') {
        onHit(e);
      } else if (e.kind === 'ko') {
        if (!battleEndedRef.current) {
          battleEndedRef.current = true;
          combatActiveRef.current = false;
          combatAudio.stopAll();

          const winner = e.winner === 'p1' ? 'player' : 'enemy';
          const loser = e.loser === 'p1' ? 'player' : 'enemy';

          const loserAnim = loser === 'player' ? playerAnimMachine : enemyAnimMachine;
          const winnerAnim = winner === 'player' ? playerAnimMachine : enemyAnimMachine;
          loserAnim.transition(AnimState.Death, true);
          winnerAnim.transition(AnimState.Victory, true);

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

    // --- Camera follows the duel ---
    // The lock-on camera frames both fighters and tracks them as they move, so a
    // fighter can't stroll out of shot. Without this the camera sat frozen at the
    // arena centre the whole fight (it was only ticked pre-combat and in hit-stop).
    battleCamera.update(clampedDt, ps.position, enemyController.state.position);

    // --- Synchronise Animation States Frame-by-Frame ---
    // Skip the idle/locomotion sync while a one-shot Fire clip is mid-play so the
    // muzzle animation isn't stomped every frame; reactions/dodge/death still
    // interrupt it (they aren't in the skip set).
    const snapshot = sim.snapshot();
    const syncAnim = (machine: AnimationStateMachine, animState: AnimState) => {
      if (machine.state === AnimState.Fire &&
          (animState === AnimState.Idle || animState === AnimState.Walk || animState === AnimState.Run)) {
        return;
      }
      machine.transition(animState);
    };
    syncAnim(playerAnimMachine, snapshot.fighters.p1.animState);
    syncAnim(enemyAnimMachine, snapshot.fighters.p2.animState);

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
      {/* Live-swappable arena — each variant is self-contained (its own lighting,
          background and seating). Toggled from the HUD button for the A/B compare. */}
      {arenaVariant === 'stylized' && <StylizedArena />}
      {arenaVariant === 'realistic' && <RealisticArena />}
      {(arenaVariant === 'battle' || arenaVariant === 'scifi') && (
        <ModelArena variant={arenaVariant} />
      )}
      {/* The procedural variants ship their own seating; the real models include
          their own stands, so the instanced Crowd only sits on the procedural ones. */}
      {(arenaVariant === 'stylized' || arenaVariant === 'realistic') && <Crowd director={crowd} />}
      {/* Cover obstacles — gameplay (collision + line-of-sight) lives in the sim;
          this draws them, matched to that data, on every arena. */}
      <CoverProps />
      <FighterModel classId={playerClass} state={playerController.state} animMachine={playerAnimMachine} accent={CLASS_ACCENTS[playerClass]} gunId={playerGun} />
      <FighterModel classId={enemyClass} state={enemyController.state} animMachine={enemyAnimMachine} accent={CLASS_ACCENTS[enemyClass]} gunId={enemyGun} />
      <primitive object={tracerFX.group} />
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

  // Art-direction A/B: live-swaps the arena. Seeds from ?arena=<id> so a specific
  // look can be deep-linked; defaults to stylized. The button cycles ARENA_CYCLE.
  const [arenaVariant, setArenaVariant] = useState<ArenaVariant>(() => {
    if (typeof window === 'undefined') return 'stylized';
    const q = new URLSearchParams(window.location.search).get('arena');
    return ARENA_CYCLE.some((a) => a.id === q) ? (q as ArenaVariant) : 'stylized';
  });
  const cycleArena = useCallback(() => {
    setArenaVariant((v) => {
      const i = ARENA_CYCLE.findIndex((a) => a.id === v);
      return ARENA_CYCLE[(i + 1) % ARENA_CYCLE.length].id;
    });
  }, []);

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
            arenaVariant={arenaVariant}
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

      {/* Arena A/B toggle — live-swaps the environment mid-fight (single deploy).
          Tap to flip Stylized <-> Semi-Real on the same fight to compare the look. */}
      <button
        onClick={cycleArena}
        className="fixed top-18 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/60 border border-white/25 text-white text-xs font-bold uppercase tracking-wider pointer-events-auto backdrop-blur-sm active:scale-95 transition shadow-lg"
      >
        Arena: <span className="text-cyan-300">{ARENA_CYCLE.find((a) => a.id === arenaVariant)?.label}</span> · tap to switch
      </button>

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
