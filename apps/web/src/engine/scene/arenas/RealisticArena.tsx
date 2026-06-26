'use client';

import { Suspense } from 'react';
import * as THREE from 'three';
import { Environment, MeshReflectorMaterial } from '@react-three/drei';

/**
 * SEMI-REALISTIC art direction — moody, cinematic, PBR.
 *
 * A real CC0 HDRI (PolyHaven "venice_sunset", self-hosted under /public/hdri)
 * drives image-based lighting + reflections; a polished reflective floor bounces
 * the fighters and the warm sky for a premium "real fighting game" feel. Dark,
 * fogged, dramatic key/rim lights. This is a DIRECTION sample (lighting does the
 * heavy lifting), not a final hand-built stage. Seating matches the Crowd tiers.
 *
 * Perf note: MeshReflectorMaterial renders an extra reflection pass — kept at a
 * modest resolution + blur so it stays mobile-friendly for the prototype.
 */

const STONE = '#1a1714';
const STONE_RISER = '#0f0d0b';
const EMBER = '#ff7a2e';

const SEAT_TIERS = [
  { inner: 11, outer: 13, y: 1.0 },
  { inner: 13, outer: 15, y: 2.0 },
  { inner: 15, outer: 17.5, y: 3.0 },
];

export function RealisticArena() {
  return (
    <group>
      {/* Dark, enclosed, atmospheric — fog hides the rim so it reads as a stage */}
      <color attach="background" args={['#08070a']} />
      <fog attach="fog" args={['#08070a', 16, 52]} />

      {/* Image-based lighting + reflections from a real HDRI. Local Suspense with a
          null fallback so loading it never blanks the whole scene on first switch. */}
      <Suspense fallback={null}>
        <Environment files="/hdri/venice_sunset_1k.hdr" environmentIntensity={0.55} />
      </Suspense>

      {/* ---- Dramatic key + rim, low ambient ---- */}
      <ambientLight color={'#2a3550'} intensity={0.35} />
      <directionalLight
        color={'#ffb070'}
        intensity={3.2}
        position={[7, 11, 4]}
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
      <directionalLight color={'#4d6bff'} intensity={1.8} position={[-6, 5, -7]} />
      <pointLight color={EMBER} intensity={2.4} distance={22} position={[0, 2, 9]} />
      <pointLight color={EMBER} intensity={2.4} distance={22} position={[0, 2, -9]} />

      {/* ---- Polished reflective floor (the premium tell) ---- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[11, 96]} />
        <MeshReflectorMaterial
          resolution={512}
          blur={[400, 200]}
          mixBlur={1}
          mixStrength={2.2}
          roughness={0.35}
          metalness={0.6}
          color={'#15110e'}
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

      {/* Pit rim wall — dark PBR stone */}
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

      {/* ---- Braziers ringing the pit for warm flickerless glow ---- */}
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

      {/* Dark enclosure so the stage doesn't float in the HDRI sky */}
      <mesh position={[0, 8, 0]}>
        <cylinderGeometry args={[19, 19, 18, 48, 1, true]} />
        <meshStandardMaterial color={'#050406'} roughness={1} metalness={0} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}
