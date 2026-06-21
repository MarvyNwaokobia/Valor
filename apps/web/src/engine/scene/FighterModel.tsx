'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimationStateMachine } from '../animation';
import type { CharacterState } from '../character';
import { loadMixamoAnimations, getMixamoClips } from '../animation/MixamoLoader';

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
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const initDone = useRef(false);
  const mixamoApplied = useRef(false);
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
      console.log(`[Fighter:${classId}] Init with ${animations.length} GLB clips`);
    }

    // Reinit when Mixamo clips are ready (check every frame via ref, not state)
    if (initDone.current && !mixamoApplied.current && mixerRef.current) {
      const mixamoClips = getMixamoClips();
      if (mixamoClips.size > 0) {
        mixamoApplied.current = true;
        const allClips = [...animations];
        for (const [name, clip] of mixamoClips) {
          if (!allClips.find(c => c.name === name)) {
            allClips.push(clip);
          }
        }
        animMachine.init(mixerRef.current, allClips);
        console.log(`[Fighter:${classId}] Reinit with ${allClips.length} clips (${mixamoClips.size} from Mixamo)`);
      }
    }

    // Update position
    groupRef.current.position.copy(state.position);
    groupRef.current.position.y = Math.max(0, groupRef.current.position.y);

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
