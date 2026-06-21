'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationStateMachine, CLASS_ANIMATIONS } from '../animation';
import type { CharacterState } from '../character';

interface FighterModelProps {
  classId: 'berserker' | 'sentinel' | 'phantom';
  state: CharacterState;
  animMachine: AnimationStateMachine;
  accent?: string;
}

const MODEL_PATH = '/models/characters/berserker/scene.gltf';
const MODEL_SCALE = 1.8;

const CLASS_COLORS: Record<string, string> = {
  berserker: '#ff4422',
  sentinel: '#4488ff',
  phantom: '#aa44ff',
};

export function FighterModel({
  classId,
  state,
  animMachine,
  accent,
}: FighterModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const initRef = useRef(false);
  const { scene, animations } = useGLTF(MODEL_PATH);

  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    const color = CLASS_COLORS[classId] ?? '#ffffff';
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = (child.material as THREE.Material).clone();
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.color.set(color);
          mat.roughness = 0.4;
          mat.emissive.set(color);
          mat.emissiveIntensity = 0.15;
        }
        child.material = mat;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  }, [scene, classId]);

  const accentColor = accent ?? CLASS_COLORS[classId] ?? '#ff4444';

  useFrame((_, dt) => {
    if (!groupRef.current) return;

    if (!initRef.current && groupRef.current.children.length > 0) {
      initRef.current = true;
      const clipNames = animations.map((a) => a.name);
      console.log(`[Fighter:${classId}] Clip names:`, clipNames.slice(0, 10).join(', '), clipNames.length > 10 ? `... (${clipNames.length} total)` : '');

      const mixer = new THREE.AnimationMixer(groupRef.current);
      mixerRef.current = mixer;
      animMachine.init(mixer, animations);

      const idleClip = animations.find((a) => a.name === '0Idle');
      if (idleClip) {
        const action = mixer.clipAction(idleClip);
        action.reset().play();
        console.log(`[Fighter:${classId}] Force-playing idle animation`);
      } else {
        console.warn(`[Fighter:${classId}] No '0Idle' clip found! Available:`, clipNames);
        if (animations.length > 0) {
          const fallback = mixer.clipAction(animations[0]);
          fallback.reset().play();
          console.log(`[Fighter:${classId}] Playing fallback: ${animations[0].name}`);
        }
      }
    }

    groupRef.current.position.copy(state.position);
    groupRef.current.scale.setScalar(MODEL_SCALE);

    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      state.rotation
    );
    groupRef.current.quaternion.slerp(targetQuat, 0.15);

    animMachine.update(dt);
  });

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
      <pointLight color={accentColor} intensity={1.5} distance={4} position={[0, 1.5, 0]} />
    </group>
  );
}
