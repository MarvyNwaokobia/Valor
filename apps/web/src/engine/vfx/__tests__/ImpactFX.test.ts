import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ImpactFX } from '../ImpactFX';

/** The sprites are irrelevant to the pooling maths — only that there is a texture. */
function fx(quality?: 'lean') {
  const t = () => new THREE.Texture();
  return new ImpactFX(
    { spark: t(), smoke: t(), debris: t(), flash: t(), droplet: t() },
    quality ? { quality } : {},
  );
}

const UP = [0, 1, 0] as const;

describe('ImpactFX pooling', () => {
  it('a burst puts particles in the world and they age out again', () => {
    const f = fx();
    expect(f.particleCount).toBe(0);
    f.burst([0, 1, 0], UP, 'concrete');
    expect(f.particleCount).toBeGreaterThan(0);
    // Longest-lived thing in a concrete burst is dust at ~1.15s.
    for (let i = 0; i < 200; i++) f.update(1 / 60);
    expect(f.particleCount).toBe(0);
    f.dispose();
  });

  it('a footfall is much cheaper than a bullet — it runs on every step of every enemy', () => {
    const f = fx();
    f.scuff([0, 0, 0]);
    const scuff = f.particleCount;
    f.dispose();

    const g = fx();
    g.burst([0, 1, 0], UP, 'concrete');
    const burst = g.particleCount;
    g.dispose();

    expect(scuff).toBeGreaterThan(0);
    expect(scuff).toBeLessThan(burst / 3);
  });

  it('a body hit throws blood, a wall hit does not', () => {
    const wall = fx();
    wall.burst([0, 1, 0], UP, 'concrete');
    const wallCount = wall.particleCount;
    wall.dispose();

    const body = fx();
    body.burst([0, 1, 0], UP, 'flesh');
    expect(body.particleCount).toBeGreaterThan(0);
    body.dispose();
    expect(wallCount).toBeGreaterThan(0);
  });

  it('never grows past its pool, however much lead is in the air', () => {
    const f = fx();
    for (let i = 0; i < 500; i++) f.burst([i % 5, 1, 0], UP, 'metal');
    const flooded = f.particleCount;
    for (let i = 0; i < 500; i++) f.burst([i % 5, 1, 0], UP, 'metal');
    expect(f.particleCount).toBe(flooded);   // capped, recycling the oldest
    f.dispose();
  });

  it('the lean tier emits fewer particles than the full one', () => {
    const full = fx();
    full.burst([0, 1, 0], UP, 'concrete');
    const a = full.particleCount;
    full.dispose();

    const lean = fx('lean');
    lean.burst([0, 1, 0], UP, 'concrete');
    const b = lean.particleCount;
    lean.dispose();

    expect(b).toBeLessThan(a);
  });

  it('a long stall cannot teleport particles across the map', () => {
    const f = fx();
    f.burst([0, 1, 0], UP, 'metal');
    // A backgrounded tab hands back a huge dt; the step is clamped.
    f.update(30);
    expect(f.particleCount).toBeGreaterThan(0);   // 30s would have killed everything
    f.dispose();
  });
});
