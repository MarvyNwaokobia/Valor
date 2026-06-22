'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';

export type StageId = 'lava_arena' | 'scifi_stage' | 'battle_arena' | 'rpg_environment';

const STAGE_COLORS: Record<StageId, { floor: string; stone: string; accent: string; glow: string; flame: string }> = {
  lava_arena:     { floor: '#241712', stone: '#2c2420', accent: '#ff6633', glow: '#ff8844', flame: '#ff7722' },
  scifi_stage:    { floor: '#15132a', stone: '#1c1b30', accent: '#8866ff', glow: '#aa88ff', flame: '#88aaff' },
  battle_arena:   { floor: '#141d28', stone: '#1e2630', accent: '#5599ff', glow: '#aaddff', flame: '#66ccff' },
  rpg_environment:{ floor: '#1d2417', stone: '#26301f', accent: '#99bb55', glow: '#bbdd77', flame: '#ffaa44' },
};

interface ArenaStageProps {
  stageId: StageId;
}

// A single flickering torch — emissive flame + (optionally) a warm point light.
function Torch({ position, color, withLight }: { position: [number, number, number]; color: string; withLight?: boolean }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const flameRef = useRef<THREE.Mesh>(null);
  const seed = useRef(Math.random() * 100);

  useFrame((state) => {
    const t = state.clock.elapsedTime * 12 + seed.current;
    const flicker = 0.75 + (Math.sin(t) * 0.5 + Math.sin(t * 2.3) * 0.5) * 0.25;
    if (lightRef.current) lightRef.current.intensity = 3.2 * flicker;
    if (flameRef.current) {
      flameRef.current.scale.set(1, 0.85 + flicker * 0.4, 1);
    }
  });

  return (
    <group position={position}>
      {/* brazier bowl */}
      <mesh position={[0, -0.15, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.18, 0.3, 8]} />
        <meshStandardMaterial color="#15110e" roughness={0.9} metalness={0.3} />
      </mesh>
      {/* flame */}
      <mesh ref={flameRef} position={[0, 0.35, 0]}>
        <coneGeometry args={[0.22, 0.9, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <coneGeometry args={[0.32, 0.55, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>
      {withLight && (
        <pointLight ref={lightRef} color={color} intensity={3} distance={14} decay={2} position={[0, 0.6, 0]} />
      )}
    </group>
  );
}

function PitArena({ stageId }: { stageId: StageId }) {
  const c = STAGE_COLORS[stageId];

  // Amphitheatre terraces: each steps up and out from the pit, giving the
  // crowd somewhere to stand. Tops align with the Crowd tier heights.
  const terraces = [
    { inner: 11, outer: 13, top: 1.0, prev: 0.2 },
    { inner: 13, outer: 15, top: 2.0, prev: 1.0 },
    { inner: 15, outer: 17.5, top: 3.0, prev: 2.0 },
  ];

  const COLUMN_COUNT = 8;
  const TORCH_LIGHT_EVERY = 2; // only every Nth torch casts a light (perf)

  return (
    <group>
      {/* Pit floor — dark stone slab */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[11, 64]} />
        <meshStandardMaterial color={c.floor} roughness={0.95} metalness={0.15} />
      </mesh>

      {/* Central combat emblem — faint glowing rings */}
      {[2.2, 4.4, 7].map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <ringGeometry args={[r - 0.06, r, 64]} />
          <meshStandardMaterial color={c.accent} emissive={c.accent} emissiveIntensity={0.4} transparent opacity={0.5} />
        </mesh>
      ))}

      {/* Pit rim / barrier wall around the fighting floor */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[11, 11, 1, 64, 1, true]} />
        <meshStandardMaterial color={c.stone} roughness={0.9} metalness={0.2} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.0, 0]}>
        <ringGeometry args={[10.9, 11.25, 64]} />
        <meshStandardMaterial color={c.accent} emissive={c.accent} emissiveIntensity={0.7} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* Amphitheatre terraces (tops + vertical risers) */}
      {terraces.map((tr, i) => (
        <group key={i}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, tr.top, 0]} receiveShadow>
            <ringGeometry args={[tr.inner, tr.outer, 64]} />
            <meshStandardMaterial color={c.stone} roughness={0.95} metalness={0.1} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, (tr.top + tr.prev) / 2, 0]}>
            <cylinderGeometry args={[tr.inner, tr.inner, tr.top - tr.prev, 64, 1, true]} />
            <meshStandardMaterial color={c.floor} roughness={0.95} metalness={0.1} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      {/* Torch-lit columns ringing the pit */}
      {Array.from({ length: COLUMN_COUNT }).map((_, i) => {
        const angle = (i / COLUMN_COUNT) * Math.PI * 2 + Math.PI / COLUMN_COUNT;
        const dist = 11.4;
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 3, 0]} castShadow>
              <cylinderGeometry args={[0.45, 0.55, 6, 8]} />
              <meshStandardMaterial color={c.stone} roughness={0.85} metalness={0.25} />
            </mesh>
            {/* capital */}
            <mesh position={[0, 6.1, 0]} castShadow>
              <boxGeometry args={[1.1, 0.3, 1.1]} />
              <meshStandardMaterial color={c.stone} roughness={0.85} metalness={0.25} />
            </mesh>
            <Torch position={[0, 6.5, 0]} color={c.flame} withLight={i % TORCH_LIGHT_EVERY === 0} />
          </group>
        );
      })}

      {/* Ground braziers flanking the pit for foreground warmth */}
      {[[0, 9.5], [0, -9.5]].map(([x, z], i) => (
        <group key={`b${i}`} position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.4, 0.5, 1, 8]} />
            <meshStandardMaterial color={c.stone} roughness={0.9} metalness={0.3} />
          </mesh>
          <Torch position={[0, 1.1, 0]} color={c.flame} withLight />
        </group>
      ))}

      {/* Dark enclosure so the arena doesn't float in a void */}
      <mesh position={[0, 7, 0]}>
        <cylinderGeometry args={[19, 19, 16, 48, 1, true]} />
        <meshStandardMaterial color="#0a0810" roughness={1} metalness={0} side={THREE.BackSide} />
      </mesh>
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
    <StageErrorBoundary fallback={<PitArena stageId="battle_arena" />}>
      <PitArena stageId={stageId} />
    </StageErrorBoundary>
  );
}
