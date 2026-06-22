'use client';

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CrowdDirector } from './CrowdDirector';

interface Spectator {
  base: THREE.Vector3;
  yaw: number;
  phase: number;
  jump: number; // per-person responsiveness to surges
  bob: number;  // idle bob speed
}

// Concentric tiers of standing spectators rising away from the pit.
const TIERS = [
  { radius: 12.5, y: 1.1, count: 46 },
  { radius: 14.5, y: 2.1, count: 54 },
  { radius: 16.8, y: 3.1, count: 62 },
];

// Dark, torch-lit silhouettes with the odd brighter garment.
const CLOTHING = ['#1c1a24', '#241a1a', '#1a2024', '#2a221c', '#201a26', '#3a2a1a'];
const ACCENT = ['#7a2a1a', '#6a3a1a', '#2a3a5a', '#5a2a3a'];

function buildPersonGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.16, 0.22, 0.85, 6);
  body.translate(0, 0.425, 0);
  const head = new THREE.SphereGeometry(0.17, 8, 6);
  head.translate(0, 0.97, 0);
  const merged = mergeGeometries([body, head], false);
  return merged ?? body;
}

export function Crowd({ director }: { director: CrowdDirector }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => buildPersonGeometry(), []);

  const people = useMemo<Spectator[]>(() => {
    const list: Spectator[] = [];
    for (const tier of TIERS) {
      for (let i = 0; i < tier.count; i++) {
        const a = (i / tier.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.05;
        const r = tier.radius + (Math.random() - 0.5) * 0.8;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        list.push({
          base: new THREE.Vector3(x, tier.y + (Math.random() - 0.5) * 0.15, z),
          yaw: Math.atan2(-x, -z), // face the pit centre
          phase: Math.random() * Math.PI * 2,
          jump: 0.6 + Math.random() * 0.8,
          bob: 1.5 + Math.random() * 1.5,
        });
      }
    }
    return list;
  }, []);

  const count = people.length;

  // Per-instance clothing colour (mostly dark, a sprinkle of accents).
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const pal = Math.random() < 0.12 ? ACCENT : CLOTHING;
      c.set(pal[Math.floor(Math.random() * pal.length)]);
      mesh.setColorAt(i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    const energy = director.energy;
    const surge = director.surge;

    for (let i = 0; i < count; i++) {
      const p = people[i];
      const idle = Math.sin(t * p.bob + p.phase) * 0.03;
      const hype = energy * Math.sin(t * (3 + energy * 5) + p.phase) * 0.12;
      const hop = surge * p.jump * Math.max(0, Math.sin(t * 9 + p.phase)) * 0.4;
      const y = p.base.y + idle + hype + hop;

      dummy.position.set(p.base.x, y, p.base.z);
      dummy.rotation.set(0, p.yaw, 0);
      const squash = 1 + hop * 0.15;
      dummy.scale.set(1, squash, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, count]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow={false}
    >
      <meshStandardMaterial roughness={0.95} metalness={0.05} />
    </instancedMesh>
  );
}
