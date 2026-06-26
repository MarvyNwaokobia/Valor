'use client';

import { COVER } from '../../sim/Cover';
import type { ArenaVariant } from '../GameScene';

/**
 * Visual cover, driven by the SAME COVER data the sim uses for collision +
 * line-of-sight — so what you see is exactly what blocks you. Themed per
 * arena variant so obstacles feel native to their environment.
 */

interface CoverTheme {
  body: string;
  bodyLow: string;
  trim: string;
  cap: string;
  bodyRoughness: number;
  bodyMetalness: number;
  trimIntensity: number;
}

const COVER_THEMES: Record<ArenaVariant, CoverTheme> = {
  stylized: {
    body: '#1c2230', bodyLow: '#1a2030', trim: '#22d3ee', cap: '#11151f',
    bodyRoughness: 0.45, bodyMetalness: 0.6, trimIntensity: 1.6,
  },
  realistic: {
    body: '#2a2018', bodyLow: '#221a12', trim: '#ff7a2e', cap: '#1a1610',
    bodyRoughness: 0.75, bodyMetalness: 0.25, trimIntensity: 1.2,
  },
  scifi: {
    body: '#1c1b30', bodyLow: '#15132a', trim: '#8866ff', cap: '#0c0a1f',
    bodyRoughness: 0.35, bodyMetalness: 0.7, trimIntensity: 1.8,
  },
  industrial: {
    body: '#5a5248', bodyLow: '#4a4238', trim: '#c89060', cap: '#3a3028',
    bodyRoughness: 0.88, bodyMetalness: 0.12, trimIntensity: 0.7,
  },
};

export function CoverProps({ variant = 'stylized' }: { variant?: ArenaVariant }) {
  const theme = COVER_THEMES[variant];
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
            <mesh position={[0, c.height / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[w, c.height, d]} />
              <meshStandardMaterial
                color={isLow ? theme.bodyLow : theme.body}
                roughness={isLow ? theme.bodyRoughness + 0.1 : theme.bodyRoughness}
                metalness={isLow ? theme.bodyMetalness * 0.7 : theme.bodyMetalness}
              />
            </mesh>
            <mesh position={[0, c.height - 0.08, 0]}>
              <boxGeometry args={[w + 0.06, 0.12, d + 0.06]} />
              <meshStandardMaterial color={theme.trim} emissive={theme.trim} emissiveIntensity={theme.trimIntensity} toneMapped={false} />
            </mesh>
            <mesh position={[0, c.height + 0.04, 0]} castShadow>
              <boxGeometry args={[w * capScale, 0.16, d * capScale]} />
              <meshStandardMaterial color={theme.cap} roughness={0.5} metalness={0.7} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
