import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { GunId } from '../combat/GunStats';

/**
 * The five real weapon models, one per gun tier, for the first-person viewmodel.
 * Same models the marketplace bakes (see dev/bake-items), so the gun you buy is
 * the gun you hold. The AR + Legendary are hand-authored GLBs; the Sidearm, SMG
 * and Marksman were generated (image -> SAM 3D). Enemies keep the shared rifle
 * (OperatorRig) — this is only the player's own weapon.
 *
 * Each model is normalised into the engine's weapon convention (barrel = +Z, up =
 * +Y, origin centred, a `muzzle` anchor at the barrel tip) so the scene can hang
 * any of them off the camera identically and swap on a weapon switch.
 */

export const GUN_MODEL_URL: Record<GunId, string> = {
  sidearm: '/models/guns/sidearm.glb',
  smg: '/models/guns/smg.glb',
  assault_rifle: '/models/guns/rifle.glb',
  marksman: '/models/guns/marksman.glb',
  legendary: '/models/guns/blaster.glb',
};

/** Real-ish weapon length (metres) each model is scaled to — sets relative size. */
const GUN_LEN: Record<GunId, number> = {
  sidearm: 0.26,
  smg: 0.52,
  assault_rifle: 0.88,
  marksman: 1.12,
  legendary: 0.82,
};

/**
 * Per-model orientation fix applied AFTER the generic "longest axis → +Z" step.
 * Generated meshes don't all face the same way; flipY swings the barrel end-for-
 * end, and extra yaw/roll square up ones that lifted at an angle. Tuned by eye
 * against the viewmodel.
 */
const GUN_FIX: Record<GunId, { flipY: boolean; yaw?: number; pitch?: number; roll?: number }> = {
  sidearm:       { flipY: true },
  smg:           { flipY: true },
  assault_rifle: { flipY: true },  // matches the old rifle.ts FLIP
  marksman:      { flipY: true },
  legendary:     { flipY: true },
};

function buildPrototype(src: THREE.Object3D, gunId: GunId): THREE.Group {
  const inner = src.clone(true);
  inner.rotation.set(0, 0, 0);
  inner.position.set(0, 0, 0);
  inner.scale.set(1, 1, 1);

  // 1. longest axis of the raw model = the barrel. Rotate it onto +Z.
  const size = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3());
  if (size.x >= size.y && size.x >= size.z) inner.rotation.y = -Math.PI / 2;      // +X -> +Z
  else if (size.y >= size.x && size.y >= size.z) inner.rotation.x = Math.PI / 2;  // +Y -> +Z
  const fix = GUN_FIX[gunId];
  if (fix.flipY) inner.rotateY(Math.PI);
  if (fix.yaw) inner.rotateY(fix.yaw);
  if (fix.pitch) inner.rotateX(fix.pitch);
  if (fix.roll) inner.rotateZ(fix.roll);
  inner.updateMatrixWorld(true);

  // 2. scale to a real length, then centre on the origin.
  const len = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3()).z;
  if (len > 1e-5) inner.scale.setScalar(GUN_LEN[gunId] / len);
  inner.updateMatrixWorld(true);
  const centre = new THREE.Box3().setFromObject(inner).getCenter(new THREE.Vector3());
  inner.position.sub(centre);
  inner.updateMatrixWorld(true);

  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
  });

  const group = new THREE.Group();
  group.add(inner);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0, GUN_LEN[gunId] / 2);
  group.add(muzzle);
  group.name = `gun-${gunId}`;
  return group;
}

export const GUN_IDS = Object.keys(GUN_MODEL_URL) as GunId[];

/** Load + normalise every gun model. Returns one prototype per tier; clone before
 *  mutating. Suspends while the GLBs load, so mount under a <Suspense>. */
export function useGunPrototypes(): Record<GunId, THREE.Group> {
  const gltfs = useGLTF(GUN_IDS.map((id) => GUN_MODEL_URL[id]));
  return useMemo(() => {
    const out = {} as Record<GunId, THREE.Group>;
    GUN_IDS.forEach((id, i) => { out[id] = buildPrototype(gltfs[i].scene, id); });
    return out;
  }, [gltfs]);
}

GUN_IDS.forEach((id) => useGLTF.preload(GUN_MODEL_URL[id]));
