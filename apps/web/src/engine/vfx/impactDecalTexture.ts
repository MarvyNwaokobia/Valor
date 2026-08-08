import * as THREE from 'three';

/**
 * The bullet-hole decal sheet: a 2x2 atlas of four hand-drawn impact scars.
 *
 * Drawn on a canvas rather than shipped as an image, unlike the particle sprites
 * next door. A hole is the one part of an impact that is NOT soft: it wants a hard
 * dark core, crisp radial cracks and a bright chipped rim, and every free particle
 * sprite is a soft blob by design (they are built to be blurred and tinted). Baking
 * it here also lets the light and dark parts live in the SAME texture — a tinted
 * white sprite can only ever be one or the other, and a hole needs both.
 *
 * Four variants so a wall taking a burst doesn't show the same stamp four times;
 * ImpactFX picks one per hit and rolls it to a random angle on top.
 */

const TILE = 128;           // px per variant
const ATLAS = TILE * 2;     // 2x2
export const DECAL_TILES = 4;

/** Deterministic PRNG — the sheet is identical every session, so a hole that looks
 *  wrong on a screenshot can be reproduced. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A closed jagged ring of `points` vertices with radius wobbling in [rMin, rMax]. */
function jaggedPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rMin: number, rMax: number, points: number, rnd: () => number) {
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = rMin + (rMax - rMin) * rnd();
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawHole(ctx: CanvasRenderingContext2D, ox: number, oy: number, rnd: () => number) {
  const c = TILE / 2;
  const cx = ox + c;
  const cy = oy + c;
  ctx.save();
  // Keep every variant inside its own tile: at low mip levels neighbouring tiles
  // bleed into each other, and a 10% margin is what stops that reading as a
  // faint square around distant holes.
  ctx.beginPath();
  ctx.rect(ox, oy, TILE, TILE);
  ctx.clip();

  // 1. Dust bloom — pale powdered material thrown out around the hole.
  const dust = ctx.createRadialGradient(cx, cy, c * 0.06, cx, cy, c * 0.9);
  dust.addColorStop(0, 'rgba(206,199,185,0.34)');
  dust.addColorStop(0.5, 'rgba(196,189,176,0.17)');
  dust.addColorStop(1, 'rgba(190,183,170,0)');
  ctx.fillStyle = dust;
  jaggedPath(ctx, cx, cy, c * 0.52, c * 0.86, 22, rnd);
  ctx.fill();

  // 2. Cracks — short radial splits, tapering and fading as they run out.
  const cracks = 7 + Math.floor(rnd() * 5);
  for (let i = 0; i < cracks; i++) {
    const a = (i / cracks) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const len = c * (0.3 + rnd() * 0.5);
    let x = cx + Math.cos(a) * c * 0.16;
    let y = cy + Math.sin(a) * c * 0.16;
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const seg = len / steps;
      const wob = (rnd() - 0.5) * 0.45;
      const nx = x + Math.cos(a + wob) * seg;
      const ny = y + Math.sin(a + wob) * seg;
      ctx.strokeStyle = `rgba(26,22,19,${0.6 * (1 - t)})`;
      ctx.lineWidth = 2.4 * (1 - t) + 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      x = nx; y = ny;
    }
  }

  // 3. Chipped rim — the bright lip of fresh material around the crater, drawn
  //    before the core so the core covers its inner half.
  jaggedPath(ctx, cx, cy, c * 0.2, c * 0.3, 14, rnd);
  ctx.strokeStyle = 'rgba(232,226,212,0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 4. Core — the hole itself. Nearly opaque, so it reads as a void at any range.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.26);
  core.addColorStop(0, 'rgba(10,9,8,0.98)');
  core.addColorStop(0.62, 'rgba(22,19,16,0.92)');
  core.addColorStop(1, 'rgba(34,29,25,0.55)');
  ctx.fillStyle = core;
  jaggedPath(ctx, cx, cy, c * 0.16, c * 0.26, 16, rnd);
  ctx.fill();

  // 5. Spall — a few dark flecks so the edge isn't a clean silhouette.
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = c * (0.28 + rnd() * 0.45);
    ctx.fillStyle = `rgba(30,26,22,${0.15 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1 + rnd() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Build the 2x2 sheet. Client-only (needs a canvas); returns null under SSR. */
export function makeImpactDecalAtlas(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  for (let i = 0; i < DECAL_TILES; i++) {
    drawHole(ctx, (i % 2) * TILE, Math.floor(i / 2) * TILE, mulberry32(0x5eed + i * 977));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Clamped: a decal quad samples one tile and must never wrap into its neighbour.
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
