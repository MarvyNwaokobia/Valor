import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export const CLIP_NAMES = {
  fightIdle: 'fightIdle',
  walk: 'walk',
  run: 'run',
  jabCross: 'jabCross',
  hookPunch: 'hookPunch',
  roundhouseKick: 'roundhouseKick',
  bodyBlock: 'bodyBlock',
  dodge: 'dodge',
  hitReaction: 'hitReaction',
  gettingHit: 'gettingHit',
  shoulderFall: 'shoulderFall',
  gettingUp: 'gettingUp',
  deathForward: 'deathForward',
  victory: 'victory',
  hook: 'hook',
  fistFight: 'fistFight',
  rollKick: 'rollKick',
  roundhouseAlt: 'roundhouseAlt',
  uppercut: 'uppercut',
  takingPunch: 'takingPunch',
  outwardBlock: 'outwardBlock',
  dodgeWalk: 'dodgeWalk',
  jumpDown: 'jumpDown',
  runRoll: 'runRoll',
  victoryAlt: 'victoryAlt',
  standUp: 'standUp',
  reaction: 'reaction',
  hitReactionAlt: 'hitReactionAlt',
  gettingUpAlt: 'gettingUpAlt',
} as const;

const ALL_ANIMS: Record<string, string> = {
  [CLIP_NAMES.fightIdle]: '/characters/raw/Fighting Idle.fbx',
  [CLIP_NAMES.walk]: '/characters/raw/Walking.fbx',
  [CLIP_NAMES.run]: '/characters/raw/Running.fbx',
  [CLIP_NAMES.jabCross]: '/characters/raw/Jab Cross.fbx',
  [CLIP_NAMES.hookPunch]: '/characters/raw/Hook Punch.fbx',
  [CLIP_NAMES.roundhouseKick]: '/characters/raw/Roundhouse Kick.fbx',
  [CLIP_NAMES.bodyBlock]: '/characters/raw/Body Block.fbx',
  [CLIP_NAMES.dodge]: '/characters/raw/Dodging.fbx',
  [CLIP_NAMES.hitReaction]: '/characters/raw/Hit Reaction.fbx',
  [CLIP_NAMES.gettingHit]: '/characters/raw/Getting Hit.fbx',
  [CLIP_NAMES.shoulderFall]: '/characters/raw/Shoulder Hit And Fall.fbx',
  [CLIP_NAMES.gettingUp]: '/characters/raw/Getting Up.fbx',
  [CLIP_NAMES.deathForward]: '/characters/raw/Standing Death Forward 02.fbx',
  [CLIP_NAMES.victory]: '/characters/raw/Victory.fbx',
  [CLIP_NAMES.hook]: '/characters/raw/Hook.fbx',
  [CLIP_NAMES.fistFight]: '/characters/raw/Fist Fight A.fbx',
  [CLIP_NAMES.rollKick]: '/characters/raw/Roll Kicking.fbx',
  [CLIP_NAMES.roundhouseAlt]: '/characters/raw/Roundhouse Kicking.fbx',
  [CLIP_NAMES.uppercut]: '/characters/raw/Receiving A Big Uppercut.fbx',
  [CLIP_NAMES.takingPunch]: '/characters/raw/Taking Punch.fbx',
  [CLIP_NAMES.outwardBlock]: '/characters/raw/Outward Block.fbx',
  [CLIP_NAMES.dodgeWalk]: '/characters/raw/Dodging walk.fbx',
  [CLIP_NAMES.jumpDown]: '/characters/raw/Jumping Down.fbx',
  [CLIP_NAMES.runRoll]: '/characters/raw/Running and rolling.fbx',
  [CLIP_NAMES.victoryAlt]: '/characters/raw/Victoryy.fbx',
  [CLIP_NAMES.standUp]: '/characters/raw/standing Up.fbx',
  [CLIP_NAMES.reaction]: '/characters/raw/Reaction.fbx',
  [CLIP_NAMES.hitReactionAlt]: '/characters/raw/Hit Reaction (1).fbx',
  [CLIP_NAMES.gettingUpAlt]: '/characters/raw/Getting Upp.fbx',
};

const allClips: Map<string, THREE.AnimationClip> = new Map();
let loadingPromise: Promise<void> | null = null;
let loadComplete = false;

/**
 * Per-clip locomotion measurements, taken from the Hips position track BEFORE it
 * is stripped for in-place playback. `groundSpeed` is the clip's baked horizontal
 * travel in clip-units per second at timeScale 1 — i.e. how fast the feet are
 * really moving. The locomotion blender uses it to lock the cycle cadence to the
 * body's ground speed so the feet stop skating. `hipY` is the mean hip height,
 * kept so callers can convert clip-units → world metres if the rigs differ.
 */
export interface ClipStride {
  groundSpeed: number;
  hipY: number;
}
const clipStride: Map<string, ClipStride> = new Map();

export function getClipStride(name: string): ClipStride | undefined {
  return clipStride.get(name);
}

// Reads the Hips position track and records the clip's baked horizontal stride
// speed + mean hip height under the friendly clip name. Called before the root
// track is stripped for in-place playback.
function measureRootStride(clip: THREE.AnimationClip, name: string): void {
  const hipsPos = clip.tracks.find(
    (t) => t.name.includes('Hips') && t.name.includes('position')
  );
  if (hipsPos) {
    const v = hipsPos.values; // [x,y,z, x,y,z, ...]
    const n = Math.floor(v.length / 3);
    if (n >= 2 && clip.duration > 0) {
      const x0 = v[0], z0 = v[2];
      const x1 = v[(n - 1) * 3], z1 = v[(n - 1) * 3 + 2];
      const horiz = Math.hypot(x1 - x0, z1 - z0);
      let sumY = 0;
      for (let i = 0; i < n; i++) sumY += v[i * 3 + 1];
      clipStride.set(name, {
        groundSpeed: horiz / clip.duration,
        hipY: sumY / n,
      });
    }
  }
}

function retargetClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
  // Name the clip up front so the stride map keys by the same friendly name the
  // state machine looks clips up under.
  clip.name = name;

  for (const track of clip.tracks) {
    track.name = track.name
      .replace(/^mixamorig\d*(\w)/, (_, first: string) => 'mixamorig:' + first.toUpperCase())
      .replace(/^mixamorig::/, 'mixamorig:');
  }

  // Measure baked root travel before discarding it (used to kill foot-skate).
  measureRootStride(clip, name);

  clip.tracks = clip.tracks.filter(track => {
    if (track.name.includes('Hips') && track.name.includes('position')) {
      return false;
    }
    return true;
  });

  return clip;
}

export async function loadMixamoAnimations(): Promise<Map<string, THREE.AnimationClip>> {
  if (allClips.size > 0) return allClips;
  if (loadingPromise) {
    await loadingPromise;
    return allClips;
  }

  loadingPromise = (async () => {
    const loader = new FBXLoader();
    const entries = Object.entries(ALL_ANIMS);
    console.log(`[MixamoLoader] Loading ${entries.length} animations...`);

    await Promise.allSettled(
      entries.map(async ([name, path]) => {
        try {
          const group = await loader.loadAsync(path);
          if (group.animations.length > 0) {
            const clip = retargetClip(group.animations[0], name);
            allClips.set(name, clip);
          }
        } catch (e) {
          console.warn(`[MixamoLoader] Failed: ${name} — ${(e as Error).message}`);
        }
      })
    );

    const loco = [CLIP_NAMES.walk, CLIP_NAMES.run, CLIP_NAMES.dodgeWalk].filter((n) => clipStride.has(n));
    console.log(
      `[MixamoLoader] Loaded ${allClips.size}/${entries.length} animations` +
      (loco.length
        ? ` — root motion detected on: ${loco.join(', ')}`
        : ` — locomotion clips are in-place (no baked stride; cadence is speed-matched)`)
    );
    loadComplete = true;
  })();

  await loadingPromise;
  return allClips;
}

export function getMixamoClips(): Map<string, THREE.AnimationClip> {
  return allClips;
}

// True once every Mixamo FBX has finished loading. Consumers wait on this before
// binding the clip set, so a fighter never latches a half-loaded set (which left
// walk/run missing → the idle pose sliding across the floor).
export function isMixamoLoadComplete(): boolean {
  return loadComplete;
}
