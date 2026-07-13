'use client';

/**
 * TEMP asset-baking page (not shipped): renders one gun/item mesh on a
 * transparent canvas so a Playwright script can screenshot it into
 * public/items/*.png. Select the asset with ?asset=<name>.
 */

import { Suspense, useLayoutEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import { makeGunMesh } from '@/engine/scene/GunMesh';
import { makeItemMesh, type ItemMeshId, ITEM_MESH_IDS } from '@/engine/scene/ItemMesh';
import type { GunId } from '@/engine/combat/GunStats';

const GUN_IDS: GunId[] = ['sidearm', 'smg', 'assault_rifle', 'marksman', 'legendary'];

function buildAsset(name: string): { obj: THREE.Group; isGun: boolean } {
  if (name.startsWith('gun_')) {
    return { obj: makeGunMesh(name.slice(4) as GunId), isGun: true };
  }
  if ((ITEM_MESH_IDS as string[]).includes(name)) {
    return { obj: makeItemMesh(name as ItemMeshId), isGun: false };
  }
  return { obj: makeGunMesh('sidearm'), isGun: true };
}

function Subject({ name }: { name: string }) {
  const staged = useMemo(() => {
    const { obj, isGun } = buildAsset(name);
    // Hero pose: guns show a 3/4 side profile with the muzzle to the right;
    // items get a gentle 3/4 turn.
    obj.rotation.set(isGun ? 0.08 : 0.04, isGun ? Math.PI / 2 - 0.42 : -0.45, 0);
    const holder = new THREE.Group();
    holder.add(obj);
    holder.updateMatrixWorld(true);
    // Centre on the bounding box so every asset fills the frame the same way.
    const box = new THREE.Box3().setFromObject(holder);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.sub(c);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    return { holder, dist: (maxDim / 2) / Math.tan((30 * Math.PI) / 360) * 1.18 };
  }, [name]);

  const { camera } = useThree();
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 30;
    cam.position.set(staged.dist * 0.18, staged.dist * 0.22, staged.dist);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [camera, staged]);

  return <primitive object={staged.holder} />;
}

export default function BakeItemsPage() {
  return (
    <Suspense>
      <BakeInner />
    </Suspense>
  );
}

function BakeInner() {
  const params = useSearchParams();
  const asset = params.get('asset') ?? 'gun_sidearm';
  const all = [...GUN_IDS.map((g) => `gun_${g}`), ...ITEM_MESH_IDS];

  return (
    <div style={{ width: 640, height: 640, background: 'transparent' }}>
      {/* The app theme paints the body dark; the bake needs true transparency. */}
      <style>{'html, body { background: transparent !important; }'}</style>
      <Canvas
        id="bake-canvas"
        gl={{ alpha: true, antialias: true }}
        camera={{ fov: 30, position: [0, 0.2, 1.2] }}
        onCreated={({ gl, scene, camera }) => {
          gl.setClearColor(0x000000, 0);
          // Lower exposure so the HDRI's specular highlights survive instead of
          // blowing out to flat white — that's what sells the metal.
          gl.toneMappingExposure = 1.05;
          scene.background = null;
          camera.lookAt(0, 0, 0);
        }}
        style={{ width: 640, height: 640 }}
      >
        {/* HDRI reflections make the metal read as metal — the single biggest
            "real, not toy" lever. background stays off for the transparent bake. */}
        <Suspense fallback={null}>
          <Environment files="/hdri/venice_sunset_1k.hdr" background={false} environmentIntensity={1.15} />
        </Suspense>
        {/* A soft key + cool rim ON TOP of the HDRI — kept low so reflections,
            not raw diffuse, define the surface. */}
        <ambientLight intensity={0.15} color={'#d6dce8'} />
        <directionalLight position={[2.5, 3, 3.5]} intensity={1.4} color={'#fff2df'} />
        <directionalLight position={[-3.5, 1.5, -2.5]} intensity={1.1} color={'#9fc3ff'} />
        <Subject name={asset} />
      </Canvas>
      {/* index for the bake script */}
      <div id="asset-list" style={{ display: 'none' }}>{all.join(',')}</div>
    </div>
  );
}
