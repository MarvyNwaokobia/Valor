'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * STYLIZED art direction — bold, clean, low-poly.
 *
 * Flat saturated materials, bright even lighting, crisp shadows, a light sky (no
 * void). The "polished mobile / Valorant-lite" look: readable and intentional
 * rather than photoreal. Self-contained — brings its own lights, background and
 * spectator seating (sized to the Crowd tiers at r=12.5/14.5/16.8).
 */

const FLOOR = '#27314f';      // deep slate-indigo
const FLOOR_EDGE = '#1b2238';
const ACCENT = '#22d3ee';     // bright cyan
const ACCENT_2 = '#f472b6';   // magenta rim
const SEAT_RISER = '#1b2238';

const SEAT_TIERS = [
  { inner: 11, outer: 13, y: 1.0 },
  { inner: 13, outer: 15, y: 2.0 },
  { inner: 15, outer: 17.5, y: 3.0 },
];

export function StylizedArena() {
  const ringRef = useRef<THREE.Mesh>(null);

  // Slow pulse on the central emblem so the floor isn't dead-static.
  useFrame((state) => {
    if (ringRef.current) {
      const m = ringRef.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.6 + Math.sin(state.clock.elapsedTime * 1.6) * 0.25;
    }
  });

  const seatColors = useMemo(() => ['#323c5e', '#2b3454', '#374267'], []);

  return (
    <group>
      {/* Background + airy fog (NOT a black void — that's the stylized tell) */}
      <color attach="background" args={['#141a30']} />
      <fog attach="fog" args={['#1b2440', 30, 75]} />

      {/* ---- Lighting: bright, even, clean ---- */}
      <hemisphereLight color={'#cfe0ff'} groundColor={'#3a4368'} intensity={1.15} />
      <ambientLight color={'#9fb4e0'} intensity={0.5} />
      <directionalLight
        color={'#ffffff'}
        intensity={2.6}
        position={[6, 12, 5]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0008}
      />
      {/* Coloured rim accents for pop */}
      <pointLight color={ACCENT} intensity={2.2} distance={26} position={[-9, 4, -6]} />
      <pointLight color={ACCENT_2} intensity={2.0} distance={26} position={[9, 4, 6]} />

      {/* ---- Fighting floor: clean disc + bright border ---- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[11, 72]} />
        <meshStandardMaterial color={FLOOR} roughness={0.55} metalness={0.05} flatShading />
      </mesh>

      {/* Central emblem rings (pulsing accent) */}
      {[2.4, 5, 7.6].map((r, i) => (
        <mesh key={i} ref={i === 1 ? ringRef : undefined} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]}>
          <ringGeometry args={[r - 0.12, r, 72]} />
          <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.6} transparent opacity={0.85} />
        </mesh>
      ))}

      {/* Bright accent rim ring at the floor edge */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[10.85, 11.1, 72]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={1.4} />
      </mesh>

      {/* Low border wall around the pit */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[11, 11, 0.9, 72, 1, true]} />
        <meshStandardMaterial color={FLOOR_EDGE} roughness={0.6} metalness={0.1} side={THREE.DoubleSide} flatShading />
      </mesh>

      {/* ---- Tiered seating (bold flat steps; Crowd sits on these) ---- */}
      {SEAT_TIERS.map((t, i) => (
        <group key={i}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, t.y, 0]} receiveShadow>
            <ringGeometry args={[t.inner, t.outer, 72]} />
            <meshStandardMaterial color={seatColors[i]} roughness={0.7} metalness={0.05} side={THREE.DoubleSide} flatShading />
          </mesh>
          <mesh position={[0, t.y - 0.5, 0]}>
            <cylinderGeometry args={[t.inner, t.inner, 1, 72, 1, true]} />
            <meshStandardMaterial color={SEAT_RISER} roughness={0.7} metalness={0.05} side={THREE.DoubleSide} flatShading />
          </mesh>
        </group>
      ))}

      {/* ---- Bold pylons ringing the arena with emissive caps ---- */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const x = Math.cos(a) * 11.6;
        const z = Math.sin(a) * 11.6;
        const col = i % 2 === 0 ? ACCENT : ACCENT_2;
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 2.2, 0]} castShadow>
              <boxGeometry args={[0.7, 4.4, 0.7]} />
              <meshStandardMaterial color={'#2b3454'} roughness={0.6} metalness={0.1} flatShading />
            </mesh>
            <mesh position={[0, 4.6, 0]}>
              <boxGeometry args={[0.95, 0.5, 0.95]} />
              <meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.2} />
            </mesh>
            <pointLight color={col} intensity={0.8} distance={9} position={[0, 4.6, 0]} />
          </group>
        );
      })}
    </group>
  );
}
