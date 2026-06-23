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
  jump: number;   // responsiveness to surges
  bob: number;    // idle bob speed
  height: number; // per-person scale for a natural crowd
}

// Concentric tiers of standing spectators rising away from the pit.
const TIERS = [
  { radius: 12.5, y: 1.1, count: 46 },
  { radius: 14.5, y: 2.1, count: 54 },
  { radius: 16.8, y: 3.1, count: 62 },
];

const CLOTHING = ['#2a2730', '#33222a', '#222a33', '#3a3024', '#2c2238', '#243a2c', '#3a2424', '#1e2a3a'];
const SKIN = ['#d8a878', '#b97f54', '#8d5a3c', '#e3b98f', '#7a4b32', '#c98e63'];

// A blocky-but-readable human: legs, hips, torso, splayed arms. Feet at y=0.
function buildBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const legL = new THREE.CylinderGeometry(0.06, 0.07, 0.8, 5);
  legL.translate(-0.09, 0.4, 0);
  const legR = legL.clone();
  legR.translate(0.18, 0, 0);
  parts.push(legL, legR);

  const hips = new THREE.BoxGeometry(0.3, 0.22, 0.18);
  hips.translate(0, 0.9, 0);
  parts.push(hips);

  const torso = new THREE.CylinderGeometry(0.16, 0.21, 0.55, 6);
  torso.translate(0, 1.28, 0);
  parts.push(torso);

  const armL = new THREE.CylinderGeometry(0.055, 0.06, 0.55, 5);
  armL.rotateZ(0.18);
  armL.translate(-0.24, 1.25, 0);
  const armR = new THREE.CylinderGeometry(0.055, 0.06, 0.55, 5);
  armR.rotateZ(-0.18);
  armR.translate(0.24, 1.25, 0);
  parts.push(armL, armR);

  return mergeGeometries(parts, false) ?? parts[0];
}

function buildHeadGeometry(): THREE.BufferGeometry {
  const neck = new THREE.CylinderGeometry(0.05, 0.06, 0.1, 5);
  neck.translate(0, 1.58, 0);
  const head = new THREE.SphereGeometry(0.125, 8, 6);
  head.translate(0, 1.72, 0);
  return mergeGeometries([neck, head], false) ?? head;
}

export function Crowd({ director }: { director: CrowdDirector }) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const bodyGeo = useMemo(() => buildBodyGeometry(), []);
  const headGeo = useMemo(() => buildHeadGeometry(), []);

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
          height: 0.9 + Math.random() * 0.25,
        });
      }
    }
    return list;
  }, []);

  const count = people.length;

  // Per-instance clothing + skin colours.
  useEffect(() => {
    const body = bodyRef.current;
    const head = headRef.current;
    if (!body || !head) return;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.set(CLOTHING[Math.floor(Math.random() * CLOTHING.length)]);
      body.setColorAt(i, c);
      c.set(SKIN[Math.floor(Math.random() * SKIN.length)]);
      head.setColorAt(i, c);
    }
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
  }, [count]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const body = bodyRef.current;
    const head = headRef.current;
    if (!body || !head) return;
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
      const squash = 1 + hop * 0.12;
      dummy.scale.set(p.height, p.height * squash, p.height);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);
      head.setMatrixAt(i, dummy.matrix);
    }
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[bodyGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.9} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[headGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.8} metalness={0} />
      </instancedMesh>
    </group>
  );
}
