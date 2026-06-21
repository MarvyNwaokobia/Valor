'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimationStateMachine } from '../animation';
import type { CharacterState } from '../character';
import { loadMixamoAnimations, applyMixamoToMixer } from '../animation/MixamoLoader';

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

export function FighterModel({
  classId,
  state,
  animMachine,
  accent,
}: FighterModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const initRef = useRef(false);
  const [mixamoReady, setMixamoReady] = useState(false);
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

  useEffect(() => {
    loadMixamoAnimations().then(() => setMixamoReady(true));
  }, []);

  const accentColor = accent ?? CLASS_ACCENTS[classId] ?? '#ffffff';

  useFrame((_, dt) => {
    if (!groupRef.current) return;

    if (!initRef.current && groupRef.current.children.length > 0) {
      initRef.current = true;
      const mixer = new THREE.AnimationMixer(groupRef.current);
      const allClips = applyMixamoToMixer(mixer, animations);
      animMachine.init(mixer, allClips);
      console.log(`[Fighter:${classId}] Initialized with ${allClips.length} clips: ${allClips.map(c => c.name).join(', ')}`);
    }

    if (mixamoReady && initRef.current) {
      const mixer = (animMachine as any).mixer as THREE.AnimationMixer | null;
      if (mixer) {
        const allClips = applyMixamoToMixer(mixer, animations);
        const currentClipCount = (animMachine as any).clips?.size ?? 0;
        if (allClips.length > currentClipCount) {
          animMachine.init(mixer, allClips);
          console.log(`[Fighter:${classId}] Reinit with Mixamo: ${allClips.length} clips`);
          setMixamoReady(false);
        }
      }
    }

    groupRef.current.position.copy(state.position);

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
