'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BattleCamera } from '../camera';
import { VerbSim, type VerbEvent, type EdgeAabb } from '../verb';
import { AudioDirector, combatIntensity } from '../audio';

/**
 * Slice 1 graybox: the Rift Edge with zero art (CLONE_PLAN.md).
 *
 * Everything is a gray primitive on purpose — the gate is "30 seconds of
 * muted play feels great", and gray boxes make it impossible for art to
 * carry a verb that isn't fun. The scene layer owns exactly what the sim
 * doesn't: hit-pause, camera juice, synth audio, and meshes.
 *
 * Controls: WASD move · LMB strike · hold RMB to aim, LMB throws ·
 * E recall · Space dash.
 */

// One shared layout: the sim collides/embeds against these, the render draws them.
const BLOCKS: Array<{ pos: [number, number, number]; size: [number, number, number] }> = [
  { pos: [-5, 1.1, -2], size: [1, 2.2, 1] },   // pillar left
  { pos: [5.5, 1.1, -5], size: [1, 2.2, 1] },  // pillar right
  { pos: [0, 0.6, -9], size: [3.6, 1.2, 0.6] }, // low wall far
  { pos: [-3.5, 1.25, -13], size: [4, 2.5, 0.6] }, // tall wall (throw around it)
  { pos: [7, 0.45, 2], size: [2.2, 0.9, 2.2] }, // crate cluster
];

const AABBS: EdgeAabb[] = BLOCKS.map((b) => ({
  min: [b.pos[0] - b.size[0] / 2, b.pos[1] - b.size[1] / 2, b.pos[2] - b.size[2] / 2],
  max: [b.pos[0] + b.size[0] / 2, b.pos[1] + b.size[1] / 2, b.pos[2] + b.size[2] / 2],
}));

const DUMMIES: Array<{ pos: [number, number]; walker?: boolean }> = [
  { pos: [0, -4] },
  { pos: [-4, -7] },
  { pos: [4.5, -8] },
  { pos: [1.5, -14], walker: true },
];

const FIXED_DT = 1 / 60;

// Hit-pause per beat (seconds of frozen sim).
const PAUSE = { melee: 0.06, meleeBig: 0.09, embedEnemy: 0.11, catch: 0.05, death: 0.08 };

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

function VerbWorld() {
  const { camera } = useThree();
  const sim = useMemo(
    () => new VerbSim({ dummies: DUMMIES, blocks: AABBS, heroPos: [0, 8] }),
    [],
  );
  const audio = useMemo(() => new AudioDirector(), []);
  const battleCam = useMemo(
    () => new BattleCamera(camera as THREE.PerspectiveCamera),
    [camera],
  );

  const heroRef = useRef<THREE.Group>(null);
  const swingRef = useRef<THREE.Group>(null);
  // Two renderings of one blade: in the hand (parented to the swing pivot) and
  // loose in the world (scene root, transform straight from the sim). Toggling
  // visibility beats re-parenting math.
  const edgeHeldRef = useRef<THREE.Group>(null);
  const edgeLooseRef = useRef<THREE.Group>(null);
  const dummyRefs = useRef<Array<THREE.Group | null>>([]);
  const hpRefs = useRef<Array<THREE.Mesh | null>>([]);

  const pauseRef = useRef(0);
  const accRef = useRef(0);
  const keys = useRef(new Set<string>());
  // Wall-clock time of the last landed hit — drives the score's intensity.
  const lastHitRef = useRef(-100);

  // ── Input ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      audio.unlock(); // browsers gate sound behind a gesture; any key counts
      keys.current.add(e.code);
      if (e.code === 'KeyJ') sim.pressAttack();
      if (e.code === 'KeyF') sim.pressThrow();
      if (e.code === 'KeyE') sim.pressRecall();
      if (e.code === 'Space') { e.preventDefault(); sim.pressDash(); }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const mouseDown = (e: MouseEvent) => {
      audio.unlock();
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
  }, [sim, audio]);

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
          break;
        case 'dash':
          audio.dash();
          break;
      }
    });
  }, [sim, audio, battleCam]);

  // ── Frame ──────────────────────────────────────────────────────────────────
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);

    // Hit-pause: the world holds its breath, the camera keeps breathing.
    if (pauseRef.current > 0) {
      pauseRef.current -= dt;
    } else {
      const k = keys.current;
      sim.setMove(
        (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
        (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      );
      sim.setCameraYaw(battleCam.cameraYaw);
      accRef.current += dt;
      while (accRef.current >= FIXED_DT) {
        sim.step(FIXED_DT);
        accRef.current -= FIXED_DT;
      }
    }

    if (sim.edgeState === 'recalling') {
      // Re-spatialize the whistle every frame — the arc is audible.
      audio.setWhistle(sim.edge.pos, sim.edge.recallProgress);
    }

    // Camera: OTS soft-locked to the nearest dummy; free-follow when all down.
    const target = sim.softLockTarget();
    const wantMode = target ? 'ots' : 'follow';
    if (battleCam.currentMode !== wantMode) battleCam.setMode(wantMode);
    battleCam.update(dt, sim.heroPos, target ?? undefined);

    // The camera is the ear; the score follows the fight state.
    audio.setListener(camera.position.x, camera.position.z, battleCam.cameraYaw);
    const nearest = target ? target.distanceTo(sim.heroPos) : null;
    audio.setIntensity(
      combatIntensity(nearest, performance.now() / 1000 - lastHitRef.current),
    );

    // Hero + procedural swing (graybox stand-in for real strike animations).
    if (heroRef.current) {
      heroRef.current.position.copy(sim.heroPos);
      heroRef.current.rotation.y = sim.heroYaw;
    }
    if (swingRef.current) {
      const m = sim.meleeState;
      if (m.stage > 0) {
        const spec = m.stage === 3 ? 0.55 : 0.42;
        const p = Math.min(1, m.t / spec);
        const dir = m.stage === 2 ? -1 : 1;
        if (m.stage === 3) {
          swingRef.current.rotation.set(-1.6 + p * 2.4, 0, 0); // overhead chop
        } else {
          swingRef.current.rotation.set(0, dir * (-1.2 + p * 2.4), 0);
        }
      } else {
        swingRef.current.rotation.x = THREE.MathUtils.lerp(swingRef.current.rotation.x, 0, 0.2);
        swingRef.current.rotation.y = THREE.MathUtils.lerp(swingRef.current.rotation.y, 0, 0.2);
      }
    }

    // The Edge: in-hand it rides the swing pivot; loose it flies/embeds/returns.
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

    // Probe/debug readout — headless verification reads this (no DOM re-render).
    (window as unknown as { __verbState?: object }).__verbState = {
      edge: sim.edgeState,
      hero: [sim.heroPos.x, sim.heroPos.z],
      dummies: sim.getDummies().map((d) => ({ hp: d.hp, dead: d.dead })),
    };

    // Dummies: flash on hit, crumple when dead.
    sim.getDummies().forEach((d, i) => {
      const g = dummyRefs.current[i];
      if (!g) return;
      g.position.copy(d.pos);
      const mesh = g.children[0] as THREE.Mesh;
      const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
      if (mat) {
        mat.emissive.setHex(d.flash > 0 ? 0xff3322 : 0x000000);
        mat.color.setHex(d.dead ? 0x333338 : d.walker ? 0x8a8a92 : 0x77777d);
      }
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, d.dead ? Math.PI / 2 : 0, 0.25);
      const hp = hpRefs.current[i];
      if (hp) {
        hp.visible = !d.dead;
        hp.scale.x = Math.max(0.02, d.hp / d.maxHp);
      }
    });
  });

  return (
    <>
      <hemisphereLight intensity={0.75} color="#cfd6e0" groundColor="#3a3d44" />
      <directionalLight position={[6, 10, 4]} intensity={1.1} castShadow />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[44, 44]} />
        <meshStandardMaterial color="#55565c" />
      </mesh>
      <gridHelper args={[44, 44, 0x777880, 0x64656b]} position={[0, 0.01, 0]} />

      {/* Graybox blocks */}
      {BLOCKS.map((b, i) => (
        <mesh key={i} position={b.pos} castShadow receiveShadow>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color="#6b6c72" />
        </mesh>
      ))}

      {/* Hero: capsule + nose wedge (facing) + swing pivot carrying the Edge */}
      <group ref={heroRef}>
        <mesh position={[0, 0.95, 0]} castShadow>
          <capsuleGeometry args={[0.38, 1.1, 6, 14]} />
          <meshStandardMaterial color="#9aa3b2" />
        </mesh>
        <mesh position={[0, 1.45, 0.34]}>
          <boxGeometry args={[0.14, 0.14, 0.22]} />
          <meshStandardMaterial color="#c8d0dc" />
        </mesh>
        <group ref={swingRef}>
          <group ref={edgeHeldRef} position={[0.35, 1.25, 0.25]} rotation={[-0.5, 0, 0]}>
            <EdgeMesh />
          </group>
        </group>
      </group>

      {/* The Edge, loose in the world (thrown / embedded / recalling) */}
      <group ref={edgeLooseRef} visible={false}>
        <EdgeMesh />
      </group>

      {/* Dummies */}
      {DUMMIES.map((d, i) => (
        <group key={i} ref={(el) => { dummyRefs.current[i] = el; }} position={[d.pos[0], 0, d.pos[1]]}>
          <mesh position={[0, 0.95, 0]} castShadow>
            <capsuleGeometry args={[0.45, 1.0, 6, 14]} />
            <meshStandardMaterial color="#77777d" />
          </mesh>
          <mesh
            ref={(el) => { hpRefs.current[i] = el; }}
            position={[0, 2.1, 0]}
          >
            <boxGeometry args={[0.8, 0.07, 0.02]} />
            <meshStandardMaterial color="#43d17c" />
          </mesh>
        </group>
      ))}
    </>
  );
}

export function GrayboxVerbScene() {
  const [edgeHint, setEdgeHint] = useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#404248' }}>
      <Canvas
        shadows
        camera={{ position: [0, 2.4, 12], fov: 58 }}
        onCreated={() => setEdgeHint(true)}
      >
        <VerbWorld />
      </Canvas>
      <div
        style={{
          position: 'absolute', left: 12, bottom: 12, color: '#d6dae2',
          fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.7,
          background: 'rgba(10,12,16,0.55)', padding: '10px 14px', borderRadius: 8,
          userSelect: 'none', pointerEvents: 'none',
        }}
      >
        <div style={{ color: '#37e0d8', fontWeight: 700, marginBottom: 2 }}>
          RIFT EDGE · graybox {edgeHint ? '' : '· loading'}
        </div>
        WASD move · J strike · F throw · E recall · Space dash
        <br />
        (mouse too: LMB strike, hold RMB aim + LMB throw) · sound starts on first input
      </div>
    </div>
  );
}
