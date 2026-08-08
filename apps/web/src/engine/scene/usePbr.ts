import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Load a Poly Haven (CC0) PBR set as diffuse + normal + roughness.
 *
 * Same convention AshfallCinematic uses: `{base}_diff_1k.jpg`, `{base}_nor_gl_1k.jpg`,
 * `{base}_rough_1k.jpg` under /textures/ashfall. Suspends while loading, so the
 * caller must sit under a <Suspense>.
 *
 * NOTE: drei caches textures by URL, so two calls with the same `base` share the
 * SAME texture objects (and therefore the same `repeat`). Give each surface its
 * own base, or the tiling of one will stomp the other. (Materials built with
 * `makeTriplanarMaterial` are exempt: they never read `repeat`.)
 *
 * The returned object is stable across renders as long as the textures are, which
 * matters because callers memoise materials on it — `useTexture` itself rebuilds
 * its result object every single render, so keying anything on that directly
 * rebuilds it every render too.
 */

const T = '/textures/ashfall';

export type PbrMaps = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
};

export function usePbr(base: string, repeat: [number, number]): PbrMaps {
  const maps = useTexture({
    map: `${T}/${base}_diff_1k.jpg`,
    normalMap: `${T}/${base}_nor_gl_1k.jpg`,
    roughnessMap: `${T}/${base}_rough_1k.jpg`,
  }) as unknown as PbrMaps;

  const { map, normalMap, roughnessMap } = maps;
  return useMemo(() => {
    const configured: PbrMaps = { map, normalMap, roughnessMap };
    for (const [key, tex] of Object.entries(configured) as [keyof PbrMaps, THREE.Texture][]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = 4;
    }
    return configured;
    // Keyed on the TEXTURES (stable, cached by URL), not on useTexture's result
    // object (new every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, normalMap, roughnessMap, repeat[0], repeat[1]]);
}
