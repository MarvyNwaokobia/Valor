'use client';

import { Suspense } from 'react';
import * as THREE from 'three';
import { Environment, MeshReflectorMaterial, Sky } from '@react-three/drei';

/**
 * SEMI-REALISTIC art direction — moody, cinematic, PBR, OUTDOOR.
 *
 * A sunset/golden-hour sky (drei Sky) with a real CC0 HDRI for PBR reflections,
 * warm directional sun + cool sky fill, and a polished reflective floor that
 * catches the sky colour. Open-air coliseum feel — no dark enclosure.
 */

const STONE = '#2a2420';
const STONE_RISER = '#1a1610';
const EMBER = '#ff7a2e';

const SEAT_TIERS = [
  { inner: 11, outer: 13, y: 1.0 },
  { inner: 13, outer: 15, y: 2.0 },
  { inner: 15, outer: 17.5, y: 3.0 },
];

export function RealisticArena() {
  return (
    <group>
      {/* Outdoor sky — golden-hour sun, warm turbidity */}
      <Sky
        distance={450000}
        sunPosition={[50, 15, -40]}
        inclination={0.49}
        azimuth={0.25}
        mieCoefficient={0.01}
        mieDirectionalG={0.95}
        rayleigh={2}
        turbidity={10}
      />
      <fog attach="fog" args={['#d4a574', 50, 160]} />

      {/* HDRI for PBR reflections (subtle — the sky dome does the visual work) */}
      <Suspense fallback={null}>
        <Environment files="/hdri/venice_sunset_1k.hdr" environmentIntensity={0.35} />
      </Suspense>

      {/* ---- Outdoor sunset lighting ---- */}
      <hemisphereLight color={'#ffd4a0'} groundColor={'#3a2820'} intensity={0.7} />
      <ambientLight color={'#ffc890'} intensity={0.3} />
      {/* Warm sun key */}
      <directionalLight
        color={'#ffb060'}
        intensity={3.5}
        position={[7, 12, -5]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-bias={-0.0008}
      />
      {/* Cool sky fill from the opposite side */}
      <directionalLight color={'#6688cc'} intensity={1.2} position={[-6, 8, 5]} />
      <pointLight color={EMBER} intensity={2.0} distance={22} position={[0, 2, 9]} />
      <pointLight color={EMBER} intensity={2.0} distance={22} position={[0, 2, -9]} />

      {/* ---- Polished reflective floor (catches the sky) ---- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[11, 96]} />
        <MeshReflectorMaterial
          resolution={512}
          blur={[400, 200]}
          mixBlur={1}
          mixStrength={2.2}
          roughness={0.35}
          metalness={0.6}
          color={'#201a14'}
          mirror={0}
          depthScale={0}
          minDepthThreshold={0.9}
          maxDepthThreshold={1}
        />
      </mesh>

      {/* Faint ember emblem rings */}
      {[2.6, 5.2, 7.8].map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <ringGeometry args={[r - 0.08, r, 96]} />
          <meshStandardMaterial color={EMBER} emissive={EMBER} emissiveIntensity={0.5} transparent opacity={0.35} />
        </mesh>
      ))}

      {/* Pit rim wall — warm PBR stone */}
      <mesh position={[0, 0.6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[11, 11, 1.2, 96, 1, true]} />
        <meshStandardMaterial color={STONE} roughness={0.7} metalness={0.25} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.2, 0]}>
        <ringGeometry args={[10.85, 11.2, 96]} />
        <meshStandardMaterial color={EMBER} emissive={EMBER} emissiveIntensity={1.1} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* ---- Tiered stone seating (Crowd sits on these) ---- */}
      {SEAT_TIERS.map((t, i) => (
        <group key={i}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, t.y, 0]} receiveShadow>
            <ringGeometry args={[t.inner, t.outer, 96]} />
            <meshStandardMaterial color={STONE} roughness={0.9} metalness={0.1} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, t.y - 0.5, 0]}>
            <cylinderGeometry args={[t.inner, t.inner, 1, 96, 1, true]} />
            <meshStandardMaterial color={STONE_RISER} roughness={0.95} metalness={0.05} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      {/* ---- Braziers ringing the pit ---- */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const x = Math.cos(a) * 11.7;
        const z = Math.sin(a) * 11.7;
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 1.5, 0]} castShadow>
              <cylinderGeometry args={[0.18, 0.28, 3, 10]} />
              <meshStandardMaterial color={STONE} roughness={0.85} metalness={0.3} />
            </mesh>
            <mesh position={[0, 3.1, 0]}>
              <sphereGeometry args={[0.28, 10, 10]} />
              <meshStandardMaterial color={EMBER} emissive={EMBER} emissiveIntensity={2.2} />
            </mesh>
            <pointLight color={EMBER} intensity={1.1} distance={11} position={[0, 3.1, 0]} />
          </group>
        );
      })}

      {/* Ground extending beyond the arena — sandy terrain under sunset light */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <circleGeometry args={[120, 64]} />
        <meshStandardMaterial color={'#4a3828'} roughness={0.95} metalness={0} />
      </mesh>
    </group>
  );
}
