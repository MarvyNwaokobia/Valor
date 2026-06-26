import * as THREE from 'three';

/**
 * Real gun model (CC0, Poly Pizza) normalized to the socket convention so it can
 * ride the RightHand bone exactly like the old procedural gun did:
 *   - local +Z is the firing direction,
 *   - the group is centred on origin (the grip transform in FighterModel seats it
 *     in the palm),
 *   - a `muzzle` anchor sits at the barrel tip for tracer/flash VFX.
 *
 * The source model's barrel runs along local +X, so we reorient +X → +Z, then
 * scale its longest axis to a real rifle length.
 */
export const RIFLE_URL = '/models/guns/blaster.glb';

const ORIENT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
const TARGET_LENGTH = 0.72; // metres, along the barrel (reads at the far combat camera)
// After centring, slide the gun so the GRIP (back third, bottom) sits at the socket
// origin rather than the barrel's middle — i.e. the hand holds the grip, barrel forward.
const GRIP_FORWARD = 0.16;
const GRIP_UP = 0.04;

export function buildRifle(src: THREE.Object3D): THREE.Group {
  const gun = new THREE.Group();
  gun.name = 'rifle';

  const orient = new THREE.Group();
  orient.add(src.clone(true));
  orient.quaternion.copy(ORIENT);
  orient.updateMatrixWorld(true);

  // Scale the longest axis (the barrel) to a believable rifle length.
  let box = new THREE.Box3().setFromObject(orient);
  const size = box.getSize(new THREE.Vector3());
  const scale = TARGET_LENGTH / (Math.max(size.x, size.y, size.z) || 1);
  orient.scale.setScalar(scale);
  orient.updateMatrixWorld(true);

  // Centre on origin, then slide so the grip (not the barrel middle) is at origin;
  // the FighterModel grip transform places that point in the hand.
  box = new THREE.Box3().setFromObject(orient);
  const c = box.getCenter(new THREE.Vector3());
  orient.position.set(-c.x, -c.y + GRIP_UP, -c.z + GRIP_FORWARD);
  orient.updateMatrixWorld(true);

  orient.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  gun.add(orient);

  // Muzzle anchor at the +Z barrel tip.
  const tip = new THREE.Box3().setFromObject(orient);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0, tip.max.z);
  gun.add(muzzle);

  return gun;
}
