import * as THREE from 'three';
import type { GunId } from '../combat/GunStats';

/**
 * Procedural gun meshes — no GLB needed.
 *
 * The duel renders in Three.js, so each gun is built from primitives at runtime,
 * parametrised by tier. This keeps the marketplace's different guns visually
 * distinct (a stubby sidearm vs a long marksman rifle) with zero binary assets,
 * and bakes in a `muzzle` anchor (a named Object3D at the barrel tip) so the VFX
 * layer can read its world position each frame for muzzle flash + tracer origin.
 *
 * The group's local +Z is the firing direction. It's socketed onto the fighter's
 * RightHand bone in FighterModel; the grip transform there orients it in the palm.
 */

interface GunVisual {
  length: number;  // receiver length (m)
  barrel: number;  // barrel length (m)
  color: number;
  accent: number;
  glow: number;    // emissive intensity on the accent parts
}

const GUN_VISUALS: Record<GunId, GunVisual> = {
  sidearm:       { length: 0.20, barrel: 0.10, color: 0x2b2f36, accent: 0x9aa0a6, glow: 0.12 },
  smg:           { length: 0.30, barrel: 0.16, color: 0x23262b, accent: 0xffaa33, glow: 0.18 },
  assault_rifle: { length: 0.46, barrel: 0.28, color: 0x2a2d33, accent: 0x33cc66, glow: 0.2 },
  marksman:      { length: 0.62, barrel: 0.42, color: 0x1f2227, accent: 0x55aaff, glow: 0.25 },
  legendary:     { length: 0.52, barrel: 0.34, color: 0x2a2030, accent: 0xb070ff, glow: 0.6 },
};

/** Build a gun group for the given tier, with a `muzzle` anchor at the barrel tip. */
export function makeGunMesh(gunId: GunId): THREE.Group {
  const v = GUN_VISUALS[gunId] ?? GUN_VISUALS.sidearm;
  const group = new THREE.Group();
  group.name = `gun-${gunId}`;

  const bodyMat = new THREE.MeshStandardMaterial({ color: v.color, metalness: 0.65, roughness: 0.4 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: v.accent, metalness: 0.3, roughness: 0.5,
    emissive: v.accent, emissiveIntensity: v.glow,
  });

  // Receiver / body.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, v.length), bodyMat);
  body.position.z = v.length * 0.1;
  group.add(body);

  // Barrel.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, v.barrel, 8), bodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = v.length * 0.5 + v.barrel * 0.5;
  group.add(barrel);

  // Grip.
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.05), bodyMat);
  grip.position.set(0, -0.08, -v.length * 0.25);
  grip.rotation.x = -0.25;
  group.add(grip);

  // Magazine (accent colour so the tier reads at a glance).
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.05), accentMat);
  mag.position.set(0, -0.09, -v.length * 0.02);
  group.add(mag);

  // Sight / top rail accent.
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, v.length * 0.5), accentMat);
  sight.position.set(0, 0.05, 0);
  group.add(sight);

  // Muzzle anchor at the barrel tip — VFX reads this Object3D's world position.
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0, v.length * 0.5 + v.barrel);
  group.add(muzzle);

  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  return group;
}
