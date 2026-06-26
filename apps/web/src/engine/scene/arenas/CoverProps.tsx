'use client';

import { COVER } from '../../sim/Cover';

/**
 * Visual cover, driven by the SAME COVER data the sim uses for collision +
 * line-of-sight — so what you see is exactly what blocks you. Themed as dark
 * tech barriers with an emissive trim that reads on every arena variant.
 * Piece shapes/sizes/heights vary per match thanks to the procedural layout.
 */
export function CoverProps({ accent = '#22d3ee' }: { accent?: string }) {
  return (
    <group>
      {COVER.map((c, i) => {
        const w = c.hx * 2;
        const d = c.hz * 2;
        const isLow = c.height < 1.05;
        const isTall = c.height > 1.5;
        const capScale = isTall ? 0.75 : 0.82;
        return (
          <group key={i} position={[c.x, 0, c.z]}>
            {/* Body */}
            <mesh position={[0, c.height / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[w, c.height, d]} />
              <meshStandardMaterial
                color={isLow ? '#1a2030' : '#1c2230'}
                roughness={isLow ? 0.6 : 0.45}
                metalness={isLow ? 0.4 : 0.6}
              />
            </mesh>
            {/* Emissive trim near the top edge */}
            <mesh position={[0, c.height - 0.08, 0]}>
              <boxGeometry args={[w + 0.06, 0.12, d + 0.06]} />
              <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.6} toneMapped={false} />
            </mesh>
            {/* Bevelled cap */}
            <mesh position={[0, c.height + 0.04, 0]} castShadow>
              <boxGeometry args={[w * capScale, 0.16, d * capScale]} />
              <meshStandardMaterial color="#11151f" roughness={0.5} metalness={0.7} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
