'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimationStateMachine } from '../animation';
import type { CharacterState } from '../character';

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

const MODEL_SCALE = 0.01;

const CLASS_ACCENTS: Record<string, string> = {
  berserker: '#ef4444',
  sentinel: '#3b82f6',
  phantom: '#8b5cf6',
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
  const modelPath = MODEL_PATHS[classId];
  const { scene, animations } = useGLTF(modelPath);

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

  const accentColor = accent ?? CLASS_ACCENTS[classId] ?? '#ffffff';

  useFrame((_, dt) => {
    if (!groupRef.current) return;

    if (!initRef.current && groupRef.current.children.length > 0) {
      initRef.current = true;
      const mixer = new THREE.AnimationMixer(groupRef.current);
      mixerRef.current = mixer;
      animMachine.init(mixer, animations);
      console.log(`[Fighter:${classId}] Loaded ${animations.length} anims: ${animations.map(a => a.name).join(', ')}`);
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
      <pointLight color={accentColor} intensity={2} distance={5} position={[0, 1.5, 0]} />
    </group>
  );
}
