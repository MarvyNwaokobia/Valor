'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BattleCamera } from '../camera';
import { VerbSim, computeEdgeArrow, type VerbEvent, type EdgeAabb, type Archetype } from '../verb';
import { AudioDirector, combatIntensity } from '../audio';

/**
 * The verb graybox — CLONE_PLAN.md slices 1 (verb), 3 (no-cut), 4 (combat).
 *
 * One continuous camera across the whole session:
 *   title (drifting wide shot) → swoop to OTS → combat → last kill:
 *   slow-mo killcam + CLEARED · or the enemies win: DOWN → back to title.
 *
 * Slice 4 rules on display here:
 *  - enemies attack under an aggression-token director (max 2 at once)
 *  - every attack has a visible windup pulse and an audible, spatialized tell
 *  - attacks from OFF-SCREEN get an edge arrow (the GoW readability rule)
 *  - the dash is the dodge (i-frames), gunner shots die on cover,
 *    the bulwark's front guard breaks via posture or a recall through its back
 *
 * Controls: WASD move · J strike · F throw · E recall · Space dash.
 */

type Phase = 'title' | 'combat' | 'cleared' | 'down';

const BLOCKS: Array<{ pos: [number, number, number]; size: [number, number, number] }> = [
  { pos: [-5, 1.1, -2], size: [1, 2.2, 1] },
  { pos: [5.5, 1.1, -5], size: [1, 2.2, 1] },
  { pos: [0, 0.6, -9], size: [3.6, 1.2, 0.6] },
  { pos: [-3.5, 1.25, -13], size: [4, 2.5, 0.6] },
  { pos: [7, 0.45, 2], size: [2.2, 0.9, 2.2] },
];

const AABBS: EdgeAabb[] = BLOCKS.map((b) => ({
  min: [b.pos[0] - b.size[0] / 2, b.pos[1] - b.size[1] / 2, b.pos[2] - b.size[2] / 2],
  max: [b.pos[0] + b.size[0] / 2, b.pos[1] + b.size[1] / 2, b.pos[2] + b.size[2] / 2],
}));

const ENEMIES: Array<{ pos: [number, number]; archetype: Archetype }> = [
  { pos: [0, -4], archetype: 'rusher' },
  { pos: [-4, -7], archetype: 'gunner' },
  { pos: [4.5, -8], archetype: 'bulwark' },
  { pos: [1.5, -14], archetype: 'rusher' },
];

const ARCHETYPE_COLOR: Record<Archetype, number> = {
  rusher: 0x9a7263,
  gunner: 0x74749a,
  bulwark: 0x64808f,
};

const FIXED_DT = 1 / 60;
const PAUSE = { melee: 0.06, meleeBig: 0.09, embedEnemy: 0.11, catch: 0.05, death: 0.08, hurt: 0.05, break: 0.1 };
const BEAT_SLOWMO_MS = 1400;
const BEAT_TOTAL_MS = 4200;
const MAX_ARROWS = 4;

interface HudRefs {
  hpFill: HTMLDivElement | null;
  vignette: HTMLDivElement | null;
  arrows: Array<HTMLDivElement | null>;
}

/** The Rift Edge: heavy short blade, teal edge-light so it tracks in flight. */
function EdgeMesh() {
  return (
    <>
      <mesh position={[0, 0, 0.45]} castShadow>
        <boxGeometry args={[0.09, 0.025, 0.9]} />
        <meshStandardMaterial color="#b9c2cc" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.44]}>
        <boxGeometry args={[0.02, 0.032, 0.86]} />
        <meshStandardMaterial color="#37e0d8" emissive="#37e0d8" emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[0, 0, -0.06]}>
        <boxGeometry args={[0.26, 0.05, 0.07]} />
        <meshStandardMaterial color="#4a4d55" />
      </mesh>
      <mesh position={[0, 0, -0.18]}>
        <cylinderGeometry args={[0.035, 0.035, 0.22]} />
        <meshStandardMaterial color="#2e3037" />
      </mesh>
    </>
  );
}

function VerbWorld({ onPhase, hud }: {
  onPhase: (phase: Phase, beatSecs?: number) => void;
  hud: HudRefs;
}) {
  const { camera } = useThree();
  const sim = useMemo(() => {
    const s = new VerbSim({ dummies: ENEMIES, blocks: AABBS, heroPos: [0, 8] });
    s.respawnEnabled = false;
    return s;
  }, []);
  const audio = useMemo(() => new AudioDirector(), []);
  const battleCam = useMemo(
    () => new BattleCamera(camera as THREE.PerspectiveCamera),
    [camera],
  );

  const heroRef = useRef<THREE.Group>(null);
  const swingRef = useRef<THREE.Group>(null);
  const edgeHeldRef = useRef<THREE.Group>(null);
  const edgeLooseRef = useRef<THREE.Group>(null);
  const fistLRef = useRef<THREE.Mesh>(null);
  const fistRRef = useRef<THREE.Mesh>(null);
  const dummyRefs = useRef<Array<THREE.Group | null>>([]);
  const hpRefs = useRef<Array<THREE.Mesh | null>>([]);
  const shieldRefs = useRef<Array<THREE.Mesh | null>>([]);
  const projRefs = useRef<Array<THREE.Mesh | null>>([]);

  const pauseRef = useRef(0);
  const accRef = useRef(0);
  const keys = useRef(new Set<string>());
  const lastHitRef = useRef(-100);
  const vignetteRef = useRef(0);

  const phaseRef = useRef<Phase>('title');
  const roundStartRef = useRef(0);
  const beatAtRef = useRef(0);

  const setPhase = useCallback((p: Phase, beatSecs?: number) => {
    phaseRef.current = p;
    onPhase(p, beatSecs);
  }, [onPhase]);

  const startCombat = useCallback(() => {
    roundStartRef.current = performance.now();
    setPhase('combat');
  }, [setPhase]);

  const enterBeat = useCallback((kind: 'cleared' | 'down') => {
    const secs = (performance.now() - roundStartRef.current) / 1000;
    beatAtRef.current = performance.now();
    setPhase(kind, secs);
    battleCam.startKillcam('player');
    battleCam.setSlowMoFov(-8);
    audio.setIntensity(0);
    audio.setHeartbeat(false);
    if (kind === 'cleared') audio.roundClear();
    else audio.heroDown();
  }, [setPhase, battleCam, audio]);

  const returnToTitle = useCallback(() => {
    sim.resetRound();
    audio.stopWhistle();
    battleCam.setSlowMoFov(0);
    battleCam.setMode('follow');
    setPhase('title');
  }, [sim, audio, battleCam, setPhase]);

  // Probe hook for headless verification.
  useEffect(() => {
    (window as unknown as { __verbKill?: () => void }).__verbKill = () => sim.debugKillAll();
    return () => { delete (window as unknown as { __verbKill?: () => void }).__verbKill; };
  }, [sim]);

  // ── Input ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const anyInput = (): boolean => {
      audio.unlock();
      if (phaseRef.current === 'title') { startCombat(); return true; }
      return phaseRef.current === 'cleared' || phaseRef.current === 'down';
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') e.preventDefault();
      if (anyInput()) return;
      keys.current.add(e.code);
      if (e.code === 'KeyJ') sim.pressAttack();
      if (e.code === 'KeyF') sim.pressThrow();
      if (e.code === 'KeyE') sim.pressRecall();
      if (e.code === 'Space') sim.pressDash();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const mouseDown = (e: MouseEvent) => {
      if (anyInput()) return;
      if (e.button === 0) sim.pressAttack();
      if (e.button === 2) sim.setAiming(true);
    };
    const mouseUp = (e: MouseEvent) => {
      if (e.button === 2) sim.setAiming(false);
    };
    const noMenu = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('mousedown', mouseDown);
    window.addEventListener('mouseup', mouseUp);
    window.addEventListener('contextmenu', noMenu);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousedown', mouseDown);
      window.removeEventListener('mouseup', mouseUp);
      window.removeEventListener('contextmenu', noMenu);
      audio.dispose();
    };
  }, [sim, audio, startCombat]);

  // ── Sim events → juice ─────────────────────────────────────────────────────
  useEffect(() => {
    return sim.onEvent((e: VerbEvent) => {
      switch (e.type) {
        case 'meleeSwing':
          break;
        case 'meleeHit': {
          const big = e.stage === 3 || e.buffed;
          audio.meleeHit(e.stage, e.buffed, e.pos);
          lastHitRef.current = performance.now() / 1000;
          pauseRef.current = Math.max(pauseRef.current, big ? PAUSE.meleeBig : PAUSE.melee);
          battleCam.shake(big ? 0.05 : 0.02, 40);
          break;
        }
        case 'meleeWhiff':
          audio.meleeWhiff(e.stage);
          break;
        case 'throw':
          audio.throw_();
          battleCam.punch(0.03);
          break;
        case 'embed':
          if (e.target.kind === 'enemy') {
            audio.embed('flesh', e.pos);
            lastHitRef.current = performance.now() / 1000;
            pauseRef.current = Math.max(pauseRef.current, PAUSE.embedEnemy);
            battleCam.shake(0.06, 35);
          } else {
            audio.embed(e.target.kind === 'ground' ? 'ground' : 'stone', e.pos);
            battleCam.shake(0.03, 30);
          }
          break;
        case 'recallStart':
          audio.rip(sim.edge.pos);
          audio.startWhistle();
          break;
        case 'recallHit':
          audio.recallHit(e.pos);
          lastHitRef.current = performance.now() / 1000;
          battleCam.shake(0.03, 40);
          break;
        case 'catch':
          audio.stopWhistle();
          audio.catch_();
          pauseRef.current = Math.max(pauseRef.current, PAUSE.catch);
          battleCam.punch(0.06);
          battleCam.shake(0.04, 45);
          break;
        case 'dummyDeath':
          audio.death(e.pos);
          lastHitRef.current = performance.now() / 1000;
          pauseRef.current = Math.max(pauseRef.current, PAUSE.death);
          if (phaseRef.current === 'combat' && sim.allDown) enterBeat('cleared');
          break;
        case 'dash':
          audio.dash();
          break;
        // ── Slice 4 ──
        case 'enemyWindup':
          audio.tell(e.archetype, e.pos);
          break;
        case 'enemyStrike':
          break; // connect/miss reads through heroHit / the visual lunge
        case 'enemyShot':
          audio.enemyShot(e.pos);
          break;
        case 'guardBlock':
          audio.embed('metal', e.pos); // the clank that says "not from the front"
          break;
        case 'postureBreak': {
          audio.embed('metal', e.pos);
          pauseRef.current = Math.max(pauseRef.current, PAUSE.break);
          battleCam.shake(0.06, 30);
          break;
        }
        case 'heroHit':
          audio.heroHit();
          vignetteRef.current = 0.8;
          pauseRef.current = Math.max(pauseRef.current, PAUSE.hurt);
          battleCam.shake(0.07, 28);
          break;
        case 'heroDown':
          if (phaseRef.current === 'combat') enterBeat('down');
          break;
      }
    });
  }, [sim, audio, battleCam, enterBeat]);

  // ── Frame ──────────────────────────────────────────────────────────────────
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const phase = phaseRef.current;
    const now = performance.now();

    let simScale = 1;
    if (phase === 'cleared' || phase === 'down') {
      simScale = now - beatAtRef.current < BEAT_SLOWMO_MS ? 0.35 : 1;
      if (now - beatAtRef.current >= BEAT_SLOWMO_MS) battleCam.setSlowMoFov(0);
      if (now - beatAtRef.current >= BEAT_TOTAL_MS) returnToTitle();
    }

    if (pauseRef.current > 0) {
      pauseRef.current -= dt;
    } else {
      const k = keys.current;
      if (phase === 'combat') {
        sim.setMove(
          (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
          (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
        );
      } else {
        sim.setMove(0, 0);
      }
      sim.setCameraYaw(battleCam.cameraYaw);
      accRef.current += dt * simScale;
      while (accRef.current >= FIXED_DT) {
        sim.step(FIXED_DT);
        accRef.current -= FIXED_DT;
      }
    }

    if (sim.edgeState === 'recalling') {
      audio.setWhistle(sim.edge.pos, sim.edge.recallProgress);
    }

    // Camera: one shot across every phase.
    const target = sim.softLockTarget();
    if (phase === 'title') {
      battleCam.rotateMouse(-38 * dt, 0);
      battleCam.update(dt, sim.heroPos);
    } else if (phase === 'combat') {
      const wantMode = target ? 'ots' : 'follow';
      if (battleCam.currentMode !== wantMode) battleCam.setMode(wantMode);
      battleCam.update(dt, sim.heroPos, target ?? undefined);
    } else if (phase === 'down') {
      // Death cam looks DOWN at the fallen body, not at standing height —
      // otherwise whoever is looming over you steals the frame.
      const body = sim.heroPos.clone().setY(-0.55);
      battleCam.update(dt, body, body);
    } else {
      battleCam.update(dt, sim.heroPos, sim.heroPos);
    }

    audio.setListener(camera.position.x, camera.position.z, battleCam.cameraYaw);
    if (phase === 'combat') {
      const nearest = target ? target.distanceTo(sim.heroPos) : null;
      audio.setIntensity(
        combatIntensity(nearest, performance.now() / 1000 - lastHitRef.current),
      );
      audio.setHeartbeat(sim.heroHp > 0 && sim.heroHp <= 30);
    }

    // Hero (falls over when down) + procedural swing.
    if (heroRef.current) {
      heroRef.current.position.copy(sim.heroPos);
      heroRef.current.rotation.y = sim.heroYaw;
      heroRef.current.rotation.z = THREE.MathUtils.lerp(
        heroRef.current.rotation.z, sim.heroIsDown ? Math.PI / 2 : 0, 0.18);
    }
    if (swingRef.current) {
      const m = sim.meleeState;
      if (m.stage > 0) {
        const spec = m.stage === 3 ? 0.55 : 0.42;
        const p = Math.min(1, m.t / spec);
        const dir = m.stage === 2 ? -1 : 1;
        if (m.stage === 3) {
          swingRef.current.rotation.set(-1.6 + p * 2.4, 0, 0);
        } else {
          swingRef.current.rotation.set(0, dir * (-1.2 + p * 2.4), 0);
        }
      } else {
        swingRef.current.rotation.x = THREE.MathUtils.lerp(swingRef.current.rotation.x, 0, 0.2);
        swingRef.current.rotation.y = THREE.MathUtils.lerp(swingRef.current.rotation.y, 0, 0.2);
      }
    }

    // Fists: visible bare-handed strikes.
    {
      const m = sim.meleeState;
      const spec = m.stage === 3 ? 0.46 : 0.34;
      const p = m.stage > 0 ? Math.min(1, m.t / spec) : 0;
      const jab = Math.sin(p * Math.PI) * 0.6;
      const unarmedSwing = !sim.armed && m.stage > 0;
      if (fistRRef.current) {
        const active = unarmedSwing && (m.stage === 1 || m.stage === 3);
        fistRRef.current.position.set(0.3, 1.1 + (m.stage === 3 ? jab * 0.25 : 0), 0.18 + (active ? jab : 0));
      }
      if (fistLRef.current) {
        const active = unarmedSwing && (m.stage === 2 || m.stage === 3);
        fistLRef.current.position.set(-0.3, 1.1 + (m.stage === 3 ? jab * 0.25 : 0), 0.18 + (active ? jab : 0));
      }
    }

    // The Edge.
    const held = sim.edgeState === 'held';
    if (edgeHeldRef.current) edgeHeldRef.current.visible = held;
    if (edgeLooseRef.current) {
      edgeLooseRef.current.visible = !held;
      if (!held) {
        edgeLooseRef.current.position.copy(sim.edge.pos);
        edgeLooseRef.current.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1), sim.edge.dir,
        );
        edgeLooseRef.current.rotateX(sim.edge.spin);
      }
    }

    // Enemies: archetype colors, windup pulse, guard shield, crumple on death.
    sim.getDummies().forEach((d, i) => {
      const g = dummyRefs.current[i];
      if (!g) return;
      g.position.copy(d.pos);
      g.rotation.y = d.yaw;
      const mesh = g.children[0] as THREE.Mesh;
      const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
      if (mat) {
        const base = d.archetype ? ARCHETYPE_COLOR[d.archetype] : 0x77777d;
        mat.color.setHex(d.dead ? 0x333338 : base);
        if (d.flash > 0) {
          mat.emissive.setHex(0xff3322);
          mat.emissiveIntensity = 1;
        } else if (d.ai === 'windup') {
          // The telegraph: amber, brightening as the strike closes in.
          const p = 1 - d.aiT / d.windupTotal;
          mat.emissive.setHex(0xffa028);
          mat.emissiveIntensity = 0.25 + p * 1.3;
        } else if (d.ai === 'broken') {
          mat.emissive.setHex(0x37e0d8); // posture broken: open season
          mat.emissiveIntensity = 0.5;
        } else {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 1;
        }
      }
      if (mesh) mesh.scale.setScalar(1 + d.flash * 0.45);
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, d.dead ? Math.PI / 2 : 0, 0.25);
      const hp = hpRefs.current[i];
      if (hp) {
        hp.visible = !d.dead;
        hp.scale.x = Math.max(0.02, d.hp / d.maxHp);
      }
      const shield = shieldRefs.current[i];
      if (shield) shield.visible = !d.dead && d.guardUp;
    });

    // Enemy projectiles.
    {
      const alive = sim.getProjectiles().filter((p) => p.alive);
      projRefs.current.forEach((m, i) => {
        if (!m) return;
        const p = alive[i];
        m.visible = !!p;
        if (p) m.position.copy(p.pos);
      });
    }

    // ── HUD (imperative DOM: no React re-renders at 60fps) ──────────────────
    if (hud.hpFill) {
      const f = sim.heroHp / sim.heroMaxHp;
      hud.hpFill.style.transform = `scaleX(${Math.max(0, f)})`;
      hud.hpFill.style.background = f > 0.5 ? '#43d17c' : f > 0.3 ? '#ffb347' : '#ff5544';
    }
    if (hud.vignette) {
      vignetteRef.current = Math.max(0, vignetteRef.current - dt * 1.6);
      const lowHp = phase === 'combat' && sim.heroHp <= 30 && !sim.heroIsDown ? 0.28 : 0;
      hud.vignette.style.opacity = String(Math.max(vignetteRef.current, lowHp));
    }

    // Off-screen threat arrows: enemies winding up outside the frame get an
    // edge indicator pointing at them (paired with the spatial audio tell).
    {
      const cam = camera as THREE.PerspectiveCamera;
      const threats = sim.getDummies().filter(
        (d) => !d.dead && (d.ai === 'windup' || d.ai === 'strike'));
      let slot = 0;
      const v = new THREE.Vector3();
      const n = new THREE.Vector3();
      for (const d of threats) {
        if (slot >= MAX_ARROWS) break;
        v.set(d.pos.x, 1.1, d.pos.z).applyMatrix4(cam.matrixWorldInverse);
        const ndc = v.z <= 0 ? n.set(d.pos.x, 1.1, d.pos.z).project(cam) : null;
        const arrow = computeEdgeArrow(v, ndc);
        if (!arrow) continue; // visibly on screen
        const el = hud.arrows[slot];
        if (el) {
          const p = d.ai === 'strike' ? 1 : 1 - d.aiT / d.windupTotal;
          el.style.display = 'block';
          el.style.left = `${arrow.leftPct}%`;
          el.style.top = `${arrow.topPct}%`;
          el.style.opacity = String(0.4 + 0.6 * p);
          el.style.transform = `translate(-50%, -50%) rotate(${arrow.deg}deg) scale(${1 + p * 0.4})`;
        }
        slot++;
      }
      for (; slot < MAX_ARROWS; slot++) {
        const el = hud.arrows[slot];
        if (el) el.style.display = 'none';
      }
    }

    // Probe/debug readout.
    (window as unknown as { __verbState?: object }).__verbState = {
      phase: phaseRef.current,
      edge: sim.edgeState,
      heroHp: sim.heroHp,
      hero: [sim.heroPos.x, sim.heroPos.z],
      cam: [camera.position.x, camera.position.y, camera.position.z],
      dummies: sim.getDummies().map((d) => ({ hp: d.hp, dead: d.dead, ai: d.ai })),
    };
  });

  return (
    <>
      <hemisphereLight intensity={0.75} color="#cfd6e0" groundColor="#3a3d44" />
      <directionalLight position={[6, 10, 4]} intensity={1.1} castShadow />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[44, 44]} />
        <meshStandardMaterial color="#55565c" />
      </mesh>
      <gridHelper args={[44, 44, 0x777880, 0x64656b]} position={[0, 0.01, 0]} />

      {BLOCKS.map((b, i) => (
        <mesh key={i} position={b.pos} castShadow receiveShadow>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color="#6b6c72" />
        </mesh>
      ))}

      <group ref={heroRef}>
        <mesh position={[0, 0.95, 0]} castShadow>
          <capsuleGeometry args={[0.38, 1.1, 6, 14]} />
          <meshStandardMaterial color="#9aa3b2" />
        </mesh>
        <mesh position={[0, 1.45, 0.34]}>
          <boxGeometry args={[0.14, 0.14, 0.22]} />
          <meshStandardMaterial color="#c8d0dc" />
        </mesh>
        <mesh ref={fistLRef} position={[-0.3, 1.1, 0.18]} castShadow>
          <sphereGeometry args={[0.13, 10, 10]} />
          <meshStandardMaterial color="#c8d0dc" />
        </mesh>
        <mesh ref={fistRRef} position={[0.3, 1.1, 0.18]} castShadow>
          <sphereGeometry args={[0.13, 10, 10]} />
          <meshStandardMaterial color="#c8d0dc" />
        </mesh>
        <group ref={swingRef}>
          <group ref={edgeHeldRef} position={[0.35, 1.25, 0.25]} rotation={[-0.5, 0, 0]}>
            <EdgeMesh />
          </group>
        </group>
      </group>

      <group ref={edgeLooseRef} visible={false}>
        <EdgeMesh />
      </group>

      {/* Enemies: capsule scaled by archetype, bulwark carries a front shield */}
      {ENEMIES.map((d, i) => (
        <group key={i} ref={(el) => { dummyRefs.current[i] = el; }} position={[d.pos[0], 0, d.pos[1]]}>
          <mesh position={[0, 0.95, 0]} castShadow>
            <capsuleGeometry args={[d.archetype === 'bulwark' ? 0.52 : 0.45, d.archetype === 'bulwark' ? 1.15 : 1.0, 6, 14]} />
            <meshStandardMaterial color="#77777d" />
          </mesh>
          {d.archetype === 'bulwark' && (
            <mesh
              ref={(el) => { shieldRefs.current[i] = el; }}
              position={[0, 1.0, 0.62]}
            >
              <boxGeometry args={[0.95, 1.25, 0.08]} />
              <meshStandardMaterial color="#5d6f7d" metalness={0.55} roughness={0.35} />
            </mesh>
          )}
          <mesh ref={(el) => { hpRefs.current[i] = el; }} position={[0, 2.2, 0]}>
            <boxGeometry args={[0.8, 0.07, 0.02]} />
            <meshStandardMaterial color="#43d17c" />
          </mesh>
        </group>
      ))}

      {/* Gunner projectile pool */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={i} ref={(el) => { projRefs.current[i] = el; }} visible={false}>
          <sphereGeometry args={[0.09, 8, 8]} />
          <meshStandardMaterial color="#ffd28a" emissive="#ff9a3c" emissiveIntensity={2.2} />
        </mesh>
      ))}
    </>
  );
}

const overlayFont: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  color: '#d6dae2',
  userSelect: 'none',
  pointerEvents: 'none',
};

export function GrayboxVerbScene() {
  const [phase, setPhase] = useState<Phase>('title');
  const [beatSecs, setBeatSecs] = useState<number | null>(null);
  const hud = useRef<HudRefs>({ hpFill: null, vignette: null, arrows: [] }).current;

  const onPhase = useCallback((p: Phase, secs?: number) => {
    setPhase(p);
    if (secs !== undefined) setBeatSecs(secs);
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#404248' }}>
      <style>{`@keyframes verbPulse { 0%,100% { opacity: 0.9 } 50% { opacity: 0.35 } }`}</style>
      <Canvas shadows camera={{ position: [0, 4, 16], fov: 55 }}>
        <VerbWorld onPhase={onPhase} hud={hud} />
      </Canvas>

      {/* Damage vignette (opacity driven imperatively) */}
      <div
        ref={(el) => { hud.vignette = el; }}
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(255,40,30,0.55) 100%)',
        }}
      />

      {/* Off-screen threat arrows */}
      {Array.from({ length: MAX_ARROWS }).map((_, i) => (
        <div
          key={i}
          ref={(el) => { hud.arrows[i] = el; }}
          style={{
            ...overlayFont, position: 'absolute', display: 'none',
            color: '#ffa028', fontSize: 26, fontWeight: 800, textShadow: '0 0 8px rgba(255,160,40,0.7)',
          }}
        >
          ▲
        </div>
      ))}

      {phase === 'title' && (
        <div style={{
          ...overlayFont, position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(10,12,16,0.5) 100%)',
        }}>
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: '0.35em', textIndent: '0.35em' }}>
            VALOR
          </div>
          <div style={{ fontSize: 14, color: '#37e0d8', letterSpacing: '0.25em' }}>
            RIFT EDGE · PROVING GROUND
          </div>
          <div style={{ fontSize: 13, marginTop: 26, animation: 'verbPulse 2.2s ease-in-out infinite' }}>
            press any key
          </div>
        </div>
      )}

      {phase === 'combat' && (
        <>
          <div style={{
            ...overlayFont, position: 'absolute', top: 14, left: 0, right: 0,
            textAlign: 'center', fontSize: 13, letterSpacing: '0.15em', opacity: 0.85,
          }}>
            DROP ALL FOUR · THEY FIGHT BACK
          </div>
          {/* Hero HP */}
          <div style={{
            position: 'absolute', bottom: 64, left: '50%', transform: 'translateX(-50%)',
            width: 240, height: 10, background: 'rgba(10,12,16,0.6)', borderRadius: 5,
            overflow: 'hidden', pointerEvents: 'none',
          }}>
            <div
              ref={(el) => { hud.hpFill = el; }}
              style={{
                width: '100%', height: '100%', background: '#43d17c',
                transformOrigin: 'left', transition: 'background 0.2s',
              }}
            />
          </div>
          <div style={{
            ...overlayFont, position: 'absolute', left: 12, bottom: 12, fontSize: 13,
            lineHeight: 1.7, background: 'rgba(10,12,16,0.55)', padding: '10px 14px', borderRadius: 8,
          }}>
            <div style={{ color: '#37e0d8', fontWeight: 700, marginBottom: 2 }}>RIFT EDGE · graybox</div>
            WASD move · J strike · F throw · E recall · Space dash (dodge)
          </div>
        </>
      )}

      {phase === 'cleared' && (
        <div style={{
          ...overlayFont, position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '0.3em', textIndent: '0.3em', color: '#37e0d8' }}>
            CLEARED
          </div>
          {beatSecs !== null && (
            <div style={{ fontSize: 15, opacity: 0.9 }}>in {beatSecs.toFixed(1)}s</div>
          )}
        </div>
      )}

      {phase === 'down' && (
        <div style={{
          ...overlayFont, position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '0.3em', textIndent: '0.3em', color: '#ff5544' }}>
            DOWN
          </div>
          {beatSecs !== null && (
            <div style={{ fontSize: 15, opacity: 0.9 }}>survived {beatSecs.toFixed(1)}s</div>
          )}
        </div>
      )}
    </div>
  );
}
