'use client';

import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimationStateMachine } from '../animation';
import type { CharacterState } from '../character';
import { loadMixamoAnimations, getMixamoClips, isMixamoLoadComplete } from '../animation';
import { makeBlobShadowTexture } from '../world/textures';

interface FighterModelProps {
  classId: 'berserker' | 'sentinel' | 'phantom';
  state: CharacterState;
  animMachine: AnimationStateMachine;
  accent?: string;
}

const MODEL_PATHS: Record<string, string> = {
  berserker: '/characters/glb/berserker.glb',
  sentinel: '/characters/glb/sentinel.glb',
  phantom: '/characters/glb/phantom.glb',
};

const CLASS_ACCENTS: Record<string, string> = {
  berserker: '#ef4444',
  sentinel: '#3b82f6',
  phantom: '#8b5cf6',
};

// Seconds for the impact squash to spring fully back to rest.
const IMPACT_DECAY = 0.13;

export const FighterModel = memo(function FighterModel({
  classId,
  state,
  animMachine,
  accent,
}: FighterModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Group>(null);
  const lean = useRef({ x: 0, z: 0 });
  const lastPos = useRef<THREE.Vector3 | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const initDone = useRef(false);
  const mixamoApplied = useRef(false);
  // Keep the fighter hidden until a real animation is driving the rig, so the
  // bind-pose T-pose (and the casual GLB idle) never show. Revealed once the
  // combat-idle clip is ready, or after a short fallback if it's slow.
  const revealed = useRef(false);
  const initTime = useRef(0);
  const modelPath = MODEL_PATHS[classId];
  const { scene, animations } = useGLTF(modelPath);
  const blobTex = useMemo(() => makeBlobShadowTexture(), []);

  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  // Start loading Mixamo animations immediately
  useMemo(() => { loadMixamoAnimations(); }, []);

  const accentColor = accent ?? CLASS_ACCENTS[classId] ?? '#ffffff';

  useFrame((_, dt) => {
    if (!groupRef.current) return;

    // First init: create mixer with GLB clips
    if (!initDone.current && groupRef.current.children.length > 0) {
      initDone.current = true;
      const mixer = new THREE.AnimationMixer(groupRef.current);
      mixerRef.current = mixer;
      animMachine.init(mixer, animations);

      const boneNames: string[] = [];
      let hipsBone: THREE.Object3D | null = null;
      groupRef.current.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          boneNames.push(child.name);
          if (!hipsBone && /hips/i.test(child.name)) hipsBone = child;
        }
      });
      // Feed the rig's bind-pose hip height to the locomotion matcher so cadence
      // scales with leg length (kills foot-skate on taller/shorter fighters).
      if (hipsBone) {
        groupRef.current.updateWorldMatrix(true, true);
        const hipY = (hipsBone as THREE.Object3D).getWorldPosition(new THREE.Vector3()).y;
        animMachine.setRigScale(hipY);
        console.log(`[Fighter:${classId}] hip height ${hipY.toFixed(2)}m → rig-scaled locomotion`);
      }
      console.log(`[Fighter:${classId}] Init with ${animations.length} GLB clips, bones: ${boneNames.slice(0, 5).join(', ')}...`);
    }

    // Wait for the FULL Mixamo set before binding — not just the first clip to
    // arrive. Latching early left walk/run unloaded, so the rig fell back to the
    // GLB idle clip and slid the idle pose across the floor (punch-list A1).
    if (initDone.current && !mixamoApplied.current && mixerRef.current && isMixamoLoadComplete()) {
      const mixamoClips = getMixamoClips();
      if (mixamoClips.size > 0) {
        mixamoApplied.current = true;
        const combined = [...animations];
        for (const [name, clip] of mixamoClips) {
          if (!combined.find(c => c.name === name)) {
            combined.push(clip);
          }
        }
        animMachine.init(mixerRef.current, combined);
        console.log(`[Fighter:${classId}] ${combined.length} clips ready (${mixamoClips.size} Mixamo + ${animations.length} GLB)`);
      }
    }

    // Reveal once the combat-idle is actually playing — never show a T-pose.
    // Prefer the Mixamo fight stance, but fall back after ~2.5s so a slow/failed
    // animation load can't leave the fighter invisible.
    if (!revealed.current && initDone.current) {
      if (initTime.current === 0) initTime.current = performance.now();
      if (mixamoApplied.current || performance.now() - initTime.current > 2500) {
        revealed.current = true;
        groupRef.current.visible = true;
        if (shadowRef.current) shadowRef.current.visible = true;
      }
    }

    // Update position
    groupRef.current.position.copy(state.position);
    groupRef.current.position.y = Math.max(0, groupRef.current.position.y);

    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      state.rotation
    );
    const rotLerp = 1 - Math.exp(-12 * dt);
    groupRef.current.quaternion.slerp(targetQuat, rotLerp);

    // Match the walk/run cycle to actual ground speed so feet don't skate.
    const planarSpeed = Math.sqrt(state.velocity.x ** 2 + state.velocity.z ** 2);
    animMachine.matchLocomotionSpeed(planarSpeed);

    // Procedural lean — tilt into movement and recoil on impact, for weight.
    // Velocity is read from actual position delta so it also captures the
    // attack lunge (which moves position directly, not via state.velocity).
    let vx = 0, vz = 0;
    if (lastPos.current && dt > 0.0001) {
      vx = THREE.MathUtils.clamp((state.position.x - lastPos.current.x) / dt, -10, 10);
      vz = THREE.MathUtils.clamp((state.position.z - lastPos.current.z) / dt, -10, 10);
    }
    (lastPos.current ??= new THREE.Vector3()).copy(state.position);
    const sin = Math.sin(state.rotation), cos = Math.cos(state.rotation);
    const fwd = vx * sin + vz * cos;
    const side = vx * cos - vz * sin;
    const targetX = -fwd * 0.045 + state.impactPulse * 0.35;
    const targetZ = side * 0.045;
    const lk = 1 - Math.exp(-10 * dt);
    lean.current.x += (targetX - lean.current.x) * lk;
    lean.current.z += (targetZ - lean.current.z) * lk;
    if (modelRef.current) modelRef.current.rotation.set(lean.current.x, 0, lean.current.z);

    // Grounding contact shadow — flat on the floor, follows the fighter.
    if (shadowRef.current) {
      shadowRef.current.position.set(state.position.x, 0.02, state.position.z);
      const s = Math.max(0.45, 1 - Math.max(0, state.position.y) * 0.18);
      shadowRef.current.scale.set(s, s, s);
    }

    // Impact scale-punch — squash on contact, springs back as the pulse decays.
    // The decay is FROZEN while the mixer is paused for hit-stop, so the squash
    // holds through the freeze (the animation-side held impact frame) and only
    // springs back once motion resumes — instead of being used up mid-freeze.
    if (state.impactPulse > 0) {
      const p = state.impactPulse;
      groupRef.current.scale.set(1 + 0.18 * p, 1 - 0.22 * p, 1 + 0.18 * p);
      if (!animMachine.isPaused) {
        state.impactPulse = Math.max(0, p - dt / IMPACT_DECAY);
        if (state.impactPulse === 0) groupRef.current.scale.set(1, 1, 1);
      }
    }

    animMachine.update(dt);
  });

  return (
    <>
      <group ref={shadowRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.7, 1.7]} />
          <meshBasicMaterial map={blobTex} transparent depthWrite={false} opacity={0.85} />
        </mesh>
      </group>
      <group ref={groupRef} visible={false}>
        <group ref={modelRef}>
          <primitive object={clonedScene} />
        </group>
        <pointLight color={accentColor} intensity={2} distance={5} position={[0, 1.5, 0]} />
      </group>
    </>
  );
});
