'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { StageId } from '../scene/ArenaStage';

interface LightConfig {
  ambient: { color: string; intensity: number };
  key: { color: string; intensity: number; position: [number, number, number] };
  fill: { color: string; intensity: number; position: [number, number, number] };
  rim: { color: string; intensity: number; position: [number, number, number] };
  ground: { color: string; intensity: number };
  pulseColor?: string;
  pulseSpeed?: number;
  pulseIntensity?: number;
}

const STAGE_LIGHTING: Record<StageId, LightConfig> = {
  lava_arena: {
    ambient: { color: '#331100', intensity: 0.6 },
    key: { color: '#ff8844', intensity: 3, position: [5, 10, 3] },
    fill: { color: '#ff4400', intensity: 1.2, position: [-4, 6, -2] },
    rim: { color: '#ff2200', intensity: 2, position: [0, 3, -8] },
    ground: { color: '#ff6600', intensity: 0.8 },
    pulseColor: '#ff4400',
    pulseSpeed: 1.5,
    pulseIntensity: 0.4,
  },
  scifi_stage: {
    ambient: { color: '#110022', intensity: 0.5 },
    key: { color: '#8866ff', intensity: 2.5, position: [0, 12, 5] },
    fill: { color: '#4422aa', intensity: 1, position: [-5, 5, -3] },
    rim: { color: '#aa44ff', intensity: 2.5, position: [3, 2, -6] },
    ground: { color: '#6644cc', intensity: 0.6 },
    pulseColor: '#6644ff',
    pulseSpeed: 0.8,
    pulseIntensity: 0.3,
  },
  battle_arena: {
    ambient: { color: '#0a1020', intensity: 0.7 },
    key: { color: '#ddeeff', intensity: 3.5, position: [6, 14, 4] },
    fill: { color: '#4466aa', intensity: 0.8, position: [-5, 8, -3] },
    rim: { color: '#2244ff', intensity: 1.8, position: [0, 3, -7] },
    ground: { color: '#334466', intensity: 0.4 },
  },
  rpg_environment: {
    ambient: { color: '#1a2210', intensity: 0.8 },
    key: { color: '#fff5dd', intensity: 2.8, position: [8, 12, 5] },
    fill: { color: '#88aa66', intensity: 0.6, position: [-6, 4, -2] },
    rim: { color: '#aabb88', intensity: 1, position: [-2, 3, -8] },
    ground: { color: '#445522', intensity: 0.3 },
  },
};

interface StageLightingProps {
  stageId: StageId;
}

export function StageLighting({ stageId }: StageLightingProps) {
  const config = STAGE_LIGHTING[stageId];
  const groundLightRef = useRef<THREE.PointLight>(null);
  const pulseRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    if (config.pulseColor && pulseRef.current) {
      const t = state.clock.elapsedTime * (config.pulseSpeed ?? 1);
      const pulse = (Math.sin(t) * 0.5 + 0.5) * (config.pulseIntensity ?? 0.3);
      pulseRef.current.intensity = pulse;
    }

    if (groundLightRef.current) {
      const flicker = 1 + Math.sin(state.clock.elapsedTime * 3.7) * 0.05;
      groundLightRef.current.intensity = config.ground.intensity * flicker;
    }
  });

  return (
    <>
      <ambientLight
        color={config.ambient.color}
        intensity={config.ambient.intensity}
      />

      <directionalLight
        color={config.key.color}
        intensity={config.key.intensity}
        position={config.key.position}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-bias={-0.001}
      />

      <directionalLight
        color={config.fill.color}
        intensity={config.fill.intensity}
        position={config.fill.position}
      />

      <directionalLight
        color={config.rim.color}
        intensity={config.rim.intensity}
        position={config.rim.position}
      />

      <pointLight
        ref={groundLightRef}
        color={config.ground.color}
        intensity={config.ground.intensity}
        distance={25}
        position={[0, 0.3, 0]}
      />

      {config.pulseColor && (
        <pointLight
          ref={pulseRef}
          color={config.pulseColor}
          intensity={0}
          distance={20}
          position={[0, 1, 0]}
        />
      )}
    </>
  );
}
