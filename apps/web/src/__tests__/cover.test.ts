import { describe, it, expect } from 'vitest';
import { COVER, resolveCover, losHit } from '../engine/sim/Cover';

describe('Cover line-of-sight', () => {
  it('blocks the straight duel-line shot through the centre block', () => {
    // Fighters spawn at ±2.5 on X, facing along z=0 — the centre piece sits there.
    const hit = losHit(-2.5, 0, 2.5, 0);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.z)).toBeLessThan(0.001);
    // First contact is the near (−x) face of the centre block.
    expect(hit!.x).toBeLessThan(0);
  });

  it('clears a sightline that runs outside every piece', () => {
    // Far down +Z, well clear of all cover footprints.
    expect(losHit(-7, 7, 7, 7)).toBeNull();
  });

  it('clears once a fighter has peeked off the centre line', () => {
    // Shooter steps wide; sightline skirts past the centre block.
    expect(losHit(-2.5, 5, 2.5, 5)).toBeNull();
  });
});

describe('Cover collision', () => {
  it('ejects a fighter standing inside a cover box', () => {
    const c = COVER[0]; // centre block at origin
    const [x, z] = resolveCover(c.x, c.z, 0.5);
    const insideX = Math.abs(x - c.x) <= c.hx;
    const insideZ = Math.abs(z - c.z) <= c.hz;
    expect(insideX && insideZ).toBe(false); // no longer inside the footprint
  });

  it('leaves a fighter clear of cover untouched', () => {
    const [x, z] = resolveCover(6, 6, 0.5);
    expect(x).toBeCloseTo(6);
    expect(z).toBeCloseTo(6);
  });

  it('pushes a fighter out to at least its radius from the box face', () => {
    const c = COVER[0];
    // Just outside the +x face, overlapping by the radius.
    const [x] = resolveCover(c.x + c.hx + 0.2, c.z, 0.5);
    expect(x).toBeGreaterThanOrEqual(c.x + c.hx + 0.5 - 1e-6);
  });
});
