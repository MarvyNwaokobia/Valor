import * as THREE from 'three';
import { DECAL_TILES, makeBloodDecalAtlas, makeImpactDecalAtlas } from './impactDecalTexture';

/**
 * Everything that happens where a round lands: a hot flash, sparks, a dust puff,
 * debris, and a bullet hole left behind on the surface.
 *
 * The FPS scene used to mark an impact with ONE expanding coloured sphere, which
 * reads as a bubble rather than a strike and leaves no trace that you shot the wall
 * at all. This replaces it with four pooled billboard layers plus a decal pool:
 *
 *   flash   additive, one frame of white heat at the point of contact
 *   sparks  additive streaks, velocity-aligned, thrown back off the surface
 *   dust    the smoke puff that hangs and drifts after the sparks have gone
 *   debris  chips of the surface, heavier, arcing down under gravity
 *   blood   liquid thrown out of a body: fat droplets that arc, land and stick
 *   decals  a bullet hole (or a blood splat) that STAYS, so a firefight writes
 *           itself onto the walls and floor
 *
 * Costs seven draw calls total no matter how much lead is in the air, because every
 * layer is one instanced quad mesh whose per-instance data is rewritten each frame.
 * Nothing allocates after construction: emitting past capacity recycles the oldest
 * particle instead of growing the pool.
 *
 * NOTE: this deliberately does not reuse `vfx/ParticleSystem.ts` (the melee-era
 * system). That one is THREE.Points with a `size` attribute that PointsMaterial
 * never reads, so every particle is the same untextured square, and point sprites
 * are clipped by their centre — a dust puff blowing past the camera would vanish.
 */

export type ImpactSurface = 'concrete' | 'dirt' | 'wood' | 'metal' | 'flesh';

export interface ImpactTextures {
  spark: THREE.Texture;
  smoke: THREE.Texture;
  debris: THREE.Texture;
  flash: THREE.Texture;
  droplet: THREE.Texture;
}

export interface ImpactFXOptions {
  /** 'lean' roughly halves particle counts and decal life for weak devices. */
  quality?: 'full' | 'lean';
}

type Vec3 = readonly [number, number, number];

// ── Billboard particle layer ──────────────────────────────────────────────────

interface EmitSpec {
  origin: Vec3;
  dir: Vec3;
  spread: number;          // 0 = a beam, 1 = a full hemisphere off `dir`
  count: number;
  speed: [number, number];
  life: [number, number];
  size: [number, number];
  color: THREE.Color;
  alpha: number;
  gravity: number;
  drag: number;            // per-second velocity retention (1 = none)
  grow?: number;           // size multiplier added over the particle's life
  jitter?: number;         // metres of positional scatter at birth
  spin?: number;           // max rad/s of billboard roll
  stretch?: number;        // extra length per m/s of speed (velocity-aligned layers)
}

interface LayerOptions {
  texture: THREE.Texture;
  capacity: number;
  additive: boolean;
  /** Rotate each quad to lie along its own velocity (streaks) instead of rolling. */
  alignVelocity?: boolean;
  /** Fraction of life spent fading in. Dust wants a little; a spark wants none. */
  fadeIn?: number;
  /** Sparks cool as they die: green and blue drop away faster than red. */
  cool?: boolean;
  /** Stop at the floor and skid instead of sinking through it. */
  bounce?: boolean;
  /** Fraction of speed kept on hitting the floor. Low = it lands wet and stays
   *  put (blood); high = it skitters away (stone chips). */
  damp?: number;
}

class BillboardLayer {
  readonly mesh: THREE.Mesh;

  private readonly cap: number;
  private readonly opts: LayerOptions;
  private count = 0;

  // Simulation state, struct-of-arrays. Sized once, never reallocated.
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly age: Float32Array; private readonly life: Float32Array;
  private readonly sw: Float32Array; private readonly sh: Float32Array;
  private readonly grow: Float32Array;
  private readonly rot: Float32Array; private readonly spin: Float32Array;
  private readonly cr: Float32Array; private readonly cg: Float32Array; private readonly cb: Float32Array;
  private readonly ca: Float32Array;
  private readonly gravity: Float32Array; private readonly drag: Float32Array;

  // GPU-side instance attributes.
  private readonly aCenter: THREE.InstancedBufferAttribute;
  private readonly aVel: THREE.InstancedBufferAttribute;
  private readonly aSize: THREE.InstancedBufferAttribute;
  private readonly aRot: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;

  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(opts: LayerOptions) {
    this.opts = opts;
    const cap = this.cap = opts.capacity;

    this.px = new Float32Array(cap); this.py = new Float32Array(cap); this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.vz = new Float32Array(cap);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap);
    this.sw = new Float32Array(cap); this.sh = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.rot = new Float32Array(cap); this.spin = new Float32Array(cap);
    this.cr = new Float32Array(cap); this.cg = new Float32Array(cap); this.cb = new Float32Array(cap);
    this.ca = new Float32Array(cap);
    this.gravity = new Float32Array(cap); this.drag = new Float32Array(cap);

    // Borrow the quad's buffers rather than disposing it: the attributes are now
    // shared with the instanced geometry, and disposing the source would hand
    // three's attribute cache a delete for buffers this layer is about to use.
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = this.geometry = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));

    this.aCenter = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.aCenter, this.aVel, this.aSize, this.aRot, this.aColor]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCenter', this.aCenter);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aRot', this.aRot);
    geo.setAttribute('aColor', this.aColor);
    geo.instanceCount = 0;

    opts.texture.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uMap: { value: null } },
      ]),
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: {
        ...(opts.alignVelocity ? { ALIGN_VELOCITY: '' } : {}),
        // Fog must DARKEN an additive sprite toward nothing; mixing it toward the
        // fog colour the way the stock chunk does would make distant sparks glow
        // brighter the further away they are.
        ...(opts.additive ? { ADDITIVE_FOG: '' } : {}),
      },
    });
    // UniformsUtils.merge clones, so the texture has to go in after the merge.
    this.material.uniforms.uMap.value = opts.texture;

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; // instances live in the attribute buffer, not the bounds
    this.mesh.renderOrder = opts.additive ? 3 : 2;
    this.mesh.matrixAutoUpdate = false;
  }

  emit(spec: EmitSpec) {
    const [ox, oy, oz] = spec.origin;
    const jitter = spec.jitter ?? 0;
    const spin = spec.spin ?? 0;
    const stretch = spec.stretch ?? 0;

    for (let n = 0; n < spec.count; n++) {
      // At capacity, the oldest particle is the one worth losing.
      const i = this.count < this.cap ? this.count++ : this.oldest();

      const dir = coneSample(spec.dir, spec.spread);
      const speed = rand(spec.speed[0], spec.speed[1]);
      const size = rand(spec.size[0], spec.size[1]);

      this.px[i] = ox + (Math.random() - 0.5) * jitter;
      this.py[i] = oy + (Math.random() - 0.5) * jitter;
      this.pz[i] = oz + (Math.random() - 0.5) * jitter;
      this.vx[i] = dir[0] * speed; this.vy[i] = dir[1] * speed; this.vz[i] = dir[2] * speed;
      this.age[i] = 0;
      this.life[i] = rand(spec.life[0], spec.life[1]);
      this.sw[i] = size;
      this.sh[i] = size * (1 + stretch * speed);
      this.grow[i] = spec.grow ?? 0;
      this.rot[i] = Math.random() * Math.PI * 2;
      this.spin[i] = (Math.random() - 0.5) * 2 * spin;
      this.cr[i] = spec.color.r; this.cg[i] = spec.color.g; this.cb[i] = spec.color.b;
      this.ca[i] = spec.alpha;
      this.gravity[i] = spec.gravity;
      this.drag[i] = spec.drag;
    }
  }

  private oldest(): number {
    let worst = 0;
    let ratio = -1;
    for (let i = 0; i < this.count; i++) {
      const r = this.age[i] / this.life[i];
      if (r > ratio) { ratio = r; worst = i; }
    }
    return worst;
  }

  /** Move the last live particle into slot `i`, so the buffer stays packed and the
   *  draw can be a single contiguous instanceCount. */
  private kill(i: number) {
    const last = --this.count;
    if (i !== last) {
      this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.age[i] = this.age[last]; this.life[i] = this.life[last];
      this.sw[i] = this.sw[last]; this.sh[i] = this.sh[last];
      this.grow[i] = this.grow[last];
      this.rot[i] = this.rot[last]; this.spin[i] = this.spin[last];
      this.cr[i] = this.cr[last]; this.cg[i] = this.cg[last]; this.cb[i] = this.cb[last];
      this.ca[i] = this.ca[last];
      this.gravity[i] = this.gravity[last]; this.drag[i] = this.drag[last];
    }
  }

  update(dt: number) {
    const wasEmpty = this.geometry.instanceCount === 0;

    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }

      this.vy[i] += this.gravity[i] * dt;
      const d = Math.pow(this.drag[i], dt * 60);
      this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;

      if (this.opts.bounce && this.py[i] < 0.01) {
        const keep = this.opts.damp ?? 0.7;
        this.py[i] = 0.01;
        this.vy[i] *= -keep * 0.4;
        this.vx[i] *= keep; this.vz[i] *= keep;
      }
    }

    const n = this.count;
    if (n === 0 && wasEmpty) return; // nothing to draw and nothing was: skip the upload

    const centre = this.aCenter.array as Float32Array;
    const vel = this.aVel.array as Float32Array;
    const size = this.aSize.array as Float32Array;
    const rot = this.aRot.array as Float32Array;
    const col = this.aColor.array as Float32Array;
    const fadeIn = this.opts.fadeIn ?? 0;

    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      const inT = fadeIn > 0 ? Math.min(1, t / fadeIn) : 1;
      const outT = (1 - t) * (1 - t);
      const fade = inT * outT;
      const scale = 1 + this.grow[i] * t;

      centre[i * 3] = this.px[i]; centre[i * 3 + 1] = this.py[i]; centre[i * 3 + 2] = this.pz[i];
      vel[i * 3] = this.vx[i]; vel[i * 3 + 1] = this.vy[i]; vel[i * 3 + 2] = this.vz[i];
      size[i * 2] = this.sw[i] * scale;
      size[i * 2 + 1] = this.sh[i] * scale;
      rot[i] = this.rot[i];

      if (this.opts.cool) {
        // White-hot, then yellow, then a dull red ember.
        const cold = 1 - t;
        col[i * 4] = this.cr[i];
        col[i * 4 + 1] = this.cg[i] * (0.35 + 0.65 * cold);
        col[i * 4 + 2] = this.cb[i] * cold * cold;
      } else {
        col[i * 4] = this.cr[i]; col[i * 4 + 1] = this.cg[i]; col[i * 4 + 2] = this.cb[i];
      }
      col[i * 4 + 3] = this.ca[i] * fade;
    }

    this.aCenter.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aRot.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.geometry.instanceCount = n;
  }

  get live(): number { return this.count; }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const PARTICLE_VERT = /* glsl */`
attribute vec3 aCenter;
attribute vec3 aVel;
attribute vec2 aSize;
attribute float aRot;
attribute vec4 aColor;

varying vec2 vUv;
varying vec4 vColor;

#include <common>
#include <fog_pars_vertex>

void main() {
  vUv = uv;
  vColor = aColor;

  // Billboard: build the quad in VIEW space around the particle centre, so it
  // always faces the camera without any per-particle CPU work.
  vec4 mvPosition = modelViewMatrix * vec4( aCenter, 1.0 );

  #ifdef ALIGN_VELOCITY
    // Lay the sprite's +Y along the direction of travel (the spark sprite is a
    // vertical streak), so a spark reads as motion rather than a floating dot.
    vec3 vView = ( modelViewMatrix * vec4( aVel, 0.0 ) ).xyz;
    float angle = length( vView.xy ) > 1e-4 ? atan( vView.y, vView.x ) - 1.5707963 : aRot;
  #else
    float angle = aRot;
  #endif

  float s = sin( angle );
  float c = cos( angle );
  vec2 corner = position.xy * aSize;
  vec2 spun = vec2( corner.x * c - corner.y * s, corner.x * s + corner.y * c );

  mvPosition.xy += spun;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const PARTICLE_FRAG = /* glsl */`
uniform sampler2D uMap;

varying vec2 vUv;
varying vec4 vColor;

#include <common>
#include <fog_pars_fragment>

void main() {
  vec4 texel = texture2D( uMap, vUv );
  gl_FragColor = vec4( vColor.rgb * texel.rgb, vColor.a * texel.a );
  if ( gl_FragColor.a < 0.004 ) discard;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogF = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    #ifdef ADDITIVE_FOG
      gl_FragColor.rgb *= 1.0 - fogF;
    #else
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogF );
    #endif
  #endif
}
`;

// ── Bullet-hole decals ────────────────────────────────────────────────────────

/**
 * A pool of quads laid flat on whatever was hit. These are pseudo-decals: a real
 * decal is projected geometry clipped to the surface it lands on, which matters on
 * curved or cluttered meshes. Everything shootable here is a big axis-aligned box
 * or the ground plane, so a quad pushed a centimetre off the surface is
 * indistinguishable and costs one instance instead of a mesh rebuild per shot.
 */
class DecalPool {
  readonly mesh: THREE.InstancedMesh;

  private readonly cap: number;
  private readonly life: number;
  private readonly fade = 2.5;      // seconds of fade-out at the end of life
  private readonly age: Float32Array;
  private readonly alive: Uint8Array;
  private readonly aAlpha: THREE.InstancedBufferAttribute;
  private readonly aTile: THREE.InstancedBufferAttribute;
  private head = 0;

  private readonly quat = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 0, 1);
  private readonly nrm = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly roll = new THREE.Quaternion();
  private readonly mat4 = new THREE.Matrix4();
  private readonly tint = new THREE.Color();

  constructor(atlas: THREE.Texture | null, capacity: number, life: number) {
    this.cap = capacity;
    this.life = life;
    this.age = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);

    const geo = new THREE.PlaneGeometry(1, 1);
    this.aTile = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aTile.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTile', this.aTile);
    geo.setAttribute('aAlpha', this.aAlpha);

    // Lambert, not Basic: a hole in a shadowed corner has to stay dark instead of
    // glowing at full brightness, and Lambert is the cheapest lit material there is.
    const mat = new THREE.MeshLambertMaterial({
      map: atlas ?? undefined,
      transparent: true,
      depthWrite: false,
      // Sits a hair in front of the wall in the depth test as well as in space —
      // belt and braces against z-fighting at a grazing angle.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aTile;\nattribute float aAlpha;\nvarying float vDecalAlpha;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
        // One quad samples one tile of the 2x2 variant sheet.
        #ifdef USE_MAP
          vMapUv = vMapUv * 0.5 + aTile;
        #endif
        vDecalAlpha = aAlpha;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDecalAlpha;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vDecalAlpha;');
    };
    mat.customProgramCacheKey = () => 'impact-decal';

    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = capacity;
    // Per-instance tint, so one grey sheet serves concrete, dirt and wood.
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);

    // Everything starts collapsed to nothing rather than stacked at the origin.
    for (let i = 0; i < capacity; i++) {
      this.mat4.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.mat4);
    }
  }

  place(point: Vec3, normal: Vec3, size: number, tint: THREE.Color) {
    const i = this.head = (this.head + 1) % this.cap;

    this.nrm.set(normal[0], normal[1], normal[2]).normalize();
    // Off the surface by a centimetre: enough to clear depth precision at range,
    // small enough that you can't see the gap with your face against the wall.
    this.pos.set(point[0], point[1], point[2]).addScaledVector(this.nrm, 0.012);
    this.quat.setFromUnitVectors(this.up, this.nrm);
    this.roll.setFromAxisAngle(this.up, Math.random() * Math.PI * 2);
    this.quat.multiply(this.roll); // random roll so repeat hits don't stamp identically
    this.scl.set(size, size, 1);
    this.mesh.setMatrixAt(i, this.mat4.compose(this.pos, this.quat, this.scl));
    this.mesh.instanceMatrix.needsUpdate = true;

    const variant = Math.floor(Math.random() * DECAL_TILES);
    this.aTile.setXY(i, (variant % 2) * 0.5, Math.floor(variant / 2) * 0.5);
    this.aTile.needsUpdate = true;

    this.tint.copy(tint);
    this.mesh.instanceColor!.setXYZ(i, this.tint.r, this.tint.g, this.tint.b);
    this.mesh.instanceColor!.needsUpdate = true;

    this.aAlpha.setX(i, 1);
    this.aAlpha.needsUpdate = true;
    this.age[i] = 0;
    this.alive[i] = 1;
  }

  update(dt: number) {
    let dirty = false;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      const remaining = this.life - this.age[i];
      if (remaining <= 0) {
        this.alive[i] = 0;
        this.aAlpha.setX(i, 0);
        this.mesh.setMatrixAt(i, this.mat4.makeScale(0, 0, 0));
        this.mesh.instanceMatrix.needsUpdate = true;
        dirty = true;
      } else if (remaining < this.fade) {
        this.aAlpha.setX(i, remaining / this.fade);
        dirty = true;
      }
    }
    if (dirty) this.aAlpha.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ── Surfaces ──────────────────────────────────────────────────────────────────

interface SurfaceLook {
  dust: THREE.Color;
  spark: number;      // sparks per hit
  debris: number;     // chips per hit
  puffs: number;      // dust billboards per hit
  puffSize: [number, number];
  decal: boolean;
  decalSize: [number, number];
}

const SURFACES: Record<ImpactSurface, SurfaceLook> = {
  // Masonry: pale powder, a decent shower of sparks off the aggregate.
  concrete: { dust: new THREE.Color('#b8b1a3'), spark: 7, debris: 4, puffs: 5, puffSize: [0.16, 0.30], decal: true, decalSize: [0.16, 0.24] },
  // Ground: little spark, a lot of kicked-up earth.
  dirt: { dust: new THREE.Color('#8b7355'), spark: 2, debris: 6, puffs: 7, puffSize: [0.20, 0.38], decal: true, decalSize: [0.20, 0.30] },
  // Timber: splinters over sparks, warmer dust.
  wood: { dust: new THREE.Color('#a08054'), spark: 3, debris: 7, puffs: 4, puffSize: [0.14, 0.26], decal: true, decalSize: [0.14, 0.22] },
  // Steel: almost all spark, barely any dust.
  metal: { dust: new THREE.Color('#9aa0a6'), spark: 16, debris: 2, puffs: 2, puffSize: [0.10, 0.18], decal: true, decalSize: [0.10, 0.16] },
  // Flesh: a red mist, plus the liquid handled separately in `burst`. No bullet
  // hole — it would be stamped onto a body that is about to walk away from it;
  // the blood goes on the GROUND, which stays put.
  flesh: { dust: new THREE.Color('#8e1410'), spark: 0, debris: 0, puffs: 6, puffSize: [0.14, 0.26], decal: false, decalSize: [0, 0] },
};

// Sparks and the flash are EMISSIVE, so they are pushed past 1 on purpose: the
// additive blend just adds more light, tone mapping rolls it back into range, and
// the scene's bloom pass has something bright enough to bite on. At 1.0 a spark is
// a beige smudge on a lit brick wall — it has to out-glow what it sits on.
const SPARK_COLOR = new THREE.Color('#ffd9a0').multiplyScalar(2.6);
const FLASH_COLOR = new THREE.Color('#fff1cf').multiplyScalar(2.2);
const BLOOD_COLOR = new THREE.Color('#6d0f0c');
// What lands and dries is darker than what's still in the air.
const BLOOD_WET = new THREE.Color('#8c0f0b');
const BLOOD_POOL = new THREE.Color('#5a0a08');

// ── The system ────────────────────────────────────────────────────────────────

export class ImpactFX {
  readonly group = new THREE.Group();

  private readonly sparks: BillboardLayer;
  private readonly dust: BillboardLayer;
  private readonly debris: BillboardLayer;
  private readonly flash: BillboardLayer;
  private readonly blood: BillboardLayer;
  private readonly decals: DecalPool;
  private readonly bloodDecals: DecalPool;
  private readonly atlas: THREE.CanvasTexture | null;
  private readonly bloodAtlas: THREE.CanvasTexture | null;
  private readonly lean: boolean;

  constructor(textures: ImpactTextures, opts: ImpactFXOptions = {}) {
    const lean = this.lean = opts.quality === 'lean';
    const cap = (full: number) => (lean ? Math.round(full * 0.45) : full);

    this.sparks = new BillboardLayer({ texture: textures.spark, capacity: cap(420), additive: true, alignVelocity: true, cool: true });
    this.flash = new BillboardLayer({ texture: textures.flash, capacity: cap(32), additive: true });
    this.dust = new BillboardLayer({ texture: textures.smoke, capacity: cap(240), additive: false, fadeIn: 0.16 });
    this.debris = new BillboardLayer({ texture: textures.debris, capacity: cap(200), additive: false, bounce: true });
    // Blood is its own layer rather than borrowing the debris one: it needs a round
    // dense sprite to read as liquid, and it has to STOP where it lands instead of
    // skidding on like a stone chip.
    this.blood = new BillboardLayer({ texture: textures.droplet, capacity: cap(260), additive: false, bounce: true, damp: 0.25 });

    this.atlas = makeImpactDecalAtlas();
    this.bloodAtlas = makeBloodDecalAtlas();
    this.decals = new DecalPool(this.atlas, lean ? 48 : 112, lean ? 12 : 24);
    // Fewer and shorter-lived than bullet holes: blood is a big stamp, and a floor
    // tiled with it stops reading as shocking and starts reading as carpet.
    this.bloodDecals = new DecalPool(this.bloodAtlas, lean ? 20 : 44, lean ? 10 : 20);

    this.group.add(
      this.dust.mesh, this.debris.mesh, this.blood.mesh, this.sparks.mesh, this.flash.mesh,
      this.decals.mesh, this.bloodDecals.mesh,
    );
    this.group.matrixAutoUpdate = false;
  }

  /**
   * One round landing. `normal` points OUT of the surface that was struck — sparks
   * and dust are thrown back along it, and the decal is laid flat against it.
   * `power` scales the whole burst (a magnum should throw more than a pistol).
   */
  burst(point: Vec3, normal: Vec3, surface: ImpactSurface, power = 1) {
    const look = SURFACES[surface];
    const n = norm(normal);
    const q = this.lean ? 0.5 : 1;
    const scale = power * q;
    // Lift the emission point a hair off the surface so the billboards aren't half
    // buried in the wall they came out of.
    const from: Vec3 = [point[0] + n[0] * 0.02, point[1] + n[1] * 0.02, point[2] + n[2] * 0.02];

    // The single frame of white heat. Always at least one, however lean we are:
    // it is what makes the hit register at all.
    this.flash.emit({
      origin: from, dir: n, spread: 0, count: 1,
      speed: [0, 0], life: [0.05, 0.08], size: [0.26 * power, 0.38 * power],
      color: surface === 'flesh' ? BLOOD_COLOR : FLASH_COLOR,
      alpha: surface === 'flesh' ? 0.5 : 1, gravity: 0, drag: 1, grow: 1.6,
    });

    const sparks = Math.round(look.spark * scale);
    if (sparks > 0) {
      this.sparks.emit({
        origin: from, dir: n, spread: 0.85, count: sparks,
        speed: [3.5, 11], life: [0.12, 0.42], size: [0.022, 0.05],
        color: SPARK_COLOR, alpha: 1, gravity: -14, drag: 0.93,
        stretch: 0.55, jitter: 0.03,
      });
    }

    const puffs = Math.max(1, Math.round(look.puffs * scale));
    this.dust.emit({
      origin: from, dir: n, spread: 0.9, count: puffs,
      speed: [0.5, 2.4], life: [0.45, 1.15], size: look.puffSize,
      // The sprite carries a lot of soft, low-alpha area, so the emitted alpha has
      // to be high for the puff to read at all past a few metres.
      color: look.dust, alpha: surface === 'flesh' ? 0.95 : 0.8,
      gravity: surface === 'flesh' ? -3.5 : -0.5, drag: 0.9,
      grow: 2.2, jitter: 0.06, spin: 1.2,
    });

    const chips = Math.round(look.debris * scale);
    if (chips > 0) {
      this.debris.emit({
        origin: from, dir: n, spread: 0.7, count: chips,
        speed: [1.8, 6], life: [0.4, 1.0], size: [0.055, 0.13],
        color: surface === 'flesh' ? BLOOD_COLOR : look.dust,
        alpha: 0.95, gravity: -16, drag: 0.97, spin: 6, jitter: 0.03,
      });
    }

    if (surface === 'flesh') this.bloodSplash(from, n, scale, point);

    if (look.decal) {
      this.decals.place(point, n, rand(look.decalSize[0], look.decalSize[1]) * (0.8 + power * 0.2), look.dust);
    }
  }

  /**
   * The wet half of a body hit: liquid thrown out of the wound, and what it leaves
   * on the floor.
   *
   * Sprayed in BOTH directions on purpose. The back-spray along `n` (which points
   * at whoever fired) is the half the shooter actually sees, so it carries the
   * read; the exit spray the other way is faster and tighter, which is what sells
   * a round having gone through something rather than splashing off it.
   */
  private bloodSplash(from: Vec3, n: Vec3, scale: number, hit: Vec3) {
    const back = Math.max(2, Math.round(11 * scale));
    this.blood.emit({
      origin: from, dir: n, spread: 0.95, count: back,
      speed: [1.6, 5.5], life: [0.5, 1.1], size: [0.035, 0.085],
      color: BLOOD_WET, alpha: 1, gravity: -17, drag: 0.985, jitter: 0.07,
    });

    const through = Math.max(1, Math.round(7 * scale));
    this.blood.emit({
      origin: from, dir: [-n[0], -n[1], -n[2]], spread: 0.45, count: through,
      speed: [3.5, 9], life: [0.45, 0.95], size: [0.03, 0.07],
      color: BLOOD_COLOR, alpha: 1, gravity: -17, drag: 0.985, jitter: 0.05,
    });

    // What hits the deck. Not every round: a burst into one body would otherwise
    // lay four overlapping stamps in the same square metre.
    if (Math.random() < 0.55) {
      // Downstream of the round, roughly where the spray would actually land.
      const throwOut = rand(0.25, 1.15);
      const at: Vec3 = [hit[0] - n[0] * throwOut, 0, hit[2] - n[2] * throwOut];
      this.bloodDecals.place(at, UP, rand(0.35, 0.7) * (0.7 + scale * 0.3), BLOOD_POOL);
    }
  }

  /**
   * Dust kicked up by a boot. Small, low and brief — a footfall, not an impact.
   *
   * Deliberately cheap: this fires for every character on every step, so a room
   * with eight enemies in it is running a dozen of these a second. One or two
   * billboards each, no sparks, no decal.
   */
  scuff(at: Vec3, power = 1) {
    const q = this.lean ? 0.5 : 1;
    // Drifts up and slightly outward, the way disturbed dust actually behaves,
    // rather than being thrown — a walking boot displaces air, it doesn't blast.
    this.dust.emit({
      origin: [at[0], at[1] + 0.04, at[2]],
      dir: UP, spread: 1.1, count: this.lean ? 1 : 2,
      speed: [0.25, 0.9], life: [0.35, 0.75], size: [0.1, 0.2],
      color: SURFACES.dirt.dust, alpha: 0.42 * power * q,
      gravity: -0.35, drag: 0.88, grow: 2.6, jitter: 0.14, spin: 0.9,
    });
  }

  update(dt: number) {
    // Clamped: a tab restored after a long stall must not teleport every spark to
    // the other side of the map in one step.
    const d = Math.min(dt, 0.1);
    this.sparks.update(d);
    this.dust.update(d);
    this.debris.update(d);
    this.blood.update(d);
    this.flash.update(d);
    this.decals.update(d);
    this.bloodDecals.update(d);
  }

  /** Live particle count across every layer — for the perf HUD / tests. */
  get particleCount(): number {
    return this.sparks.live + this.dust.live + this.debris.live + this.blood.live + this.flash.live;
  }

  dispose() {
    this.sparks.dispose();
    this.dust.dispose();
    this.debris.dispose();
    this.blood.dispose();
    this.flash.dispose();
    this.decals.dispose();
    this.bloodDecals.dispose();
    this.atlas?.dispose();
    this.bloodAtlas?.dispose();
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function rand(a: number, b: number): number {
  return a + (b - a) * Math.random();
}

const UP: Vec3 = [0, 1, 0];

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}

/** A random direction within a cone around `dir`. `spread` 0 = straight along it,
 *  1 = anywhere in the hemisphere facing it. */
function coneSample(dir: Vec3, spread: number): Vec3 {
  if (spread <= 0) return norm(dir);
  const d = norm(dir);
  // Uniform point on the sphere, pulled toward `d` by (1 - spread).
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const rx = r * Math.cos(a), ry = r * Math.sin(a), rz = z;
  return norm([
    d[0] + rx * spread,
    d[1] + ry * spread,
    d[2] + rz * spread,
  ]);
}
