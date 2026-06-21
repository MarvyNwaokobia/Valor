'use client';

import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

export type StageId = 'lava_arena' | 'scifi_stage' | 'battle_arena' | 'rpg_environment';

const STAGE_PATHS: Record<StageId, string> = {
  lava_arena: '/models/environments/lava_arena/scene.gltf',
  scifi_stage: '/models/environments/scifi_stage/scene.gltf',
  battle_arena: '/models/environments/battle_arena/scene.gltf',
  rpg_environment: '/models/environments/rpg_environment/scene.gltf',
};

const STAGE_SCALES: Record<StageId, number> = {
  lava_arena: 0.5,
  scifi_stage: 0.8,
  battle_arena: 1,
  rpg_environment: 0.3,
};

const STAGE_POSITIONS: Record<StageId, [number, number, number]> = {
  lava_arena: [0, -0.5, 0],
  scifi_stage: [0, -0.2, 0],
  battle_arena: [0, 0, 0],
  rpg_environment: [0, -0.3, 0],
};

interface ArenaStageProps {
  stageId: StageId;
}

export function ArenaStage({ stageId }: ArenaStageProps) {
  const path = STAGE_PATHS[stageId];
  const { scene } = useGLTF(path);

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.receiveShadow = true;
        child.castShadow = false;
      }
    });
    return clone;
  }, [scene]);

  const scale = STAGE_SCALES[stageId];
  const position = STAGE_POSITIONS[stageId];

  return (
    <group position={position} scale={[scale, scale, scale]}>
      <primitive object={clonedScene} />
    </group>
  );
}

Object.values(STAGE_PATHS).forEach((path) => {
  useGLTF.preload(path);
});
