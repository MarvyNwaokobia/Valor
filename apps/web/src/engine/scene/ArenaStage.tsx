'use client';

import { useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import React from 'react';

export type StageId = 'lava_arena' | 'scifi_stage' | 'battle_arena' | 'rpg_environment';

const STAGE_PATHS: Record<StageId, string> = {
  lava_arena: '/models/environments/battle_arena/scene.gltf',
  scifi_stage: '/models/environments/battle_arena/scene.gltf',
  battle_arena: '/models/environments/battle_arena/scene.gltf',
  rpg_environment: '/models/environments/battle_arena/scene.gltf',
};

const STAGE_COLORS: Record<StageId, { floor: string; accent: string; glow: string }> = {
  lava_arena: { floor: '#3a2215', accent: '#ff6633', glow: '#ff8844' },
  scifi_stage: { floor: '#1a1535', accent: '#8866ff', glow: '#aa88ff' },
  battle_arena: { floor: '#152535', accent: '#5599ff', glow: '#aaddff' },
  rpg_environment: { floor: '#253520', accent: '#99bb55', glow: '#bbdd77' },
};

interface ArenaStageProps {
  stageId: StageId;
}

function ProceduralArena({ stageId }: { stageId: StageId }) {
  const colors = STAGE_COLORS[stageId];

  return (
    <group>
      {/* Main floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[15, 64]} />
        <meshStandardMaterial
          color={colors.floor}
          roughness={0.8}
          metalness={0.2}
        />
      </mesh>

      {/* Arena ring / edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <ringGeometry args={[14, 15, 64]} />
        <meshStandardMaterial
          color={colors.accent}
          emissive={colors.accent}
          emissiveIntensity={0.5}
          roughness={0.3}
        />
      </mesh>

      {/* Center line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <ringGeometry args={[0.02, 0.05, 32]} />
        <meshStandardMaterial
          color={colors.glow}
          emissive={colors.glow}
          emissiveIntensity={1}
        />
      </mesh>

      {/* Corner pillars */}
      {[0, 1, 2, 3].map((i) => {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const dist = 13;
        return (
          <group key={i} position={[Math.cos(angle) * dist, 0, Math.sin(angle) * dist]}>
            <mesh position={[0, 1.5, 0]} castShadow>
              <cylinderGeometry args={[0.3, 0.4, 3, 8]} />
              <meshStandardMaterial color="#222" roughness={0.6} metalness={0.4} />
            </mesh>
            <pointLight
              color={colors.glow}
              intensity={0.8}
              distance={8}
              position={[0, 3.2, 0]}
            />
          </group>
        );
      })}
    </group>
  );
}

function GLTFStage({ stageId }: { stageId: StageId }) {
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

  return (
    <group>
      <primitive object={clonedScene} />
    </group>
  );
}

class StageErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function ArenaStage({ stageId }: ArenaStageProps) {
  return (
    <StageErrorBoundary fallback={<ProceduralArena stageId={stageId} />}>
      <ProceduralArena stageId={stageId} />
    </StageErrorBoundary>
  );
}
