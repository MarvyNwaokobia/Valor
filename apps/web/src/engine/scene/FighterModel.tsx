'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { AnimationStateMachine, CLASS_ANIMATIONS } from '../animation';
import type { CharacterState } from '../character';

interface FighterModelProps {
  classId: 'berserker' | 'sentinel' | 'phantom';
  state: CharacterState;
  animMachine: AnimationStateMachine;
  accent?: string;
}

const MODEL_PATHS: Record<string, string> = {
  berserker: '/models/characters/berserker/scene.gltf',
  sentinel: '/models/characters/sentinel/scene.gltf',
  phantom: '/models/characters/phantom/scene.gltf',
};

const MODEL_SCALES: Record<string, number> = {
  berserker: 1.8,
  sentinel: 0.018,
  phantom: 0.018,
};

export function FighterModel({
  classId,
  state,
  animMachine,
  accent = '#ff4444',
}: FighterModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const modelPath = MODEL_PATHS[classId];
  const { scene, animations } = useGLTF(modelPath);

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material = (child.material as THREE.Material).clone();
        }
      }
    });
    return clone;
  }, [scene]);

  const { mixer } = useAnimations(animations, groupRef);

  useEffect(() => {
    if (!mixer || animations.length === 0) return;
    const animMap = CLASS_ANIMATIONS[classId];
    if (animMap) {
      animMachine.init(mixer, animations);
    }
  }, [mixer, animations, classId, animMachine]);

  useFrame((_, dt) => {
    if (!groupRef.current) return;

    const group = groupRef.current;
    const scale = MODEL_SCALES[classId] ?? 1;

    group.position.lerp(state.position, 0.15);
    group.scale.setScalar(scale);

    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      state.rotation
    );
    group.quaternion.slerp(targetQuat, 0.12);

    animMachine.update(dt);
  });

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
      <pointLight
        color={accent}
        intensity={1.5}
        distance={4}
        position={[0, 1.5, 0]}
      />
    </group>
  );
}

Object.values(MODEL_PATHS).forEach((path) => {
  useGLTF.preload(path);
});
