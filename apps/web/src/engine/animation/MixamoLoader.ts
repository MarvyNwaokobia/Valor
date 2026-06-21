import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { AnimState } from './AnimationStateMachine';

const MIXAMO_ANIMS: Record<string, { path: string; state: AnimState }> = {
  fightIdle: { path: '/characters/raw/Fighting Idle.fbx', state: AnimState.Idle },
  walk: { path: '/characters/raw/Walking.fbx', state: AnimState.Walk },
  run: { path: '/characters/raw/Running.fbx', state: AnimState.Run },
  lightAttack: { path: '/characters/raw/Jab Cross.fbx', state: AnimState.LightAttack },
  heavyAttack: { path: '/characters/raw/Hook Punch.fbx', state: AnimState.HeavyAttack },
  special: { path: '/characters/raw/Roundhouse Kick.fbx', state: AnimState.Special },
  block: { path: '/characters/raw/Body Block.fbx', state: AnimState.Block },
  dodge: { path: '/characters/raw/Dodging.fbx', state: AnimState.Dodge },
  hitLight: { path: '/characters/raw/Hit Reaction.fbx', state: AnimState.HitLight },
  hitHeavy: { path: '/characters/raw/Getting Hit.fbx', state: AnimState.HitHeavy },
  knockdown: { path: '/characters/raw/Shoulder Hit And Fall.fbx', state: AnimState.Knockdown },
  getUp: { path: '/characters/raw/Getting Up.fbx', state: AnimState.GetUp },
  death: { path: '/characters/raw/Standing Death Forward 02.fbx', state: AnimState.Death },
  victory: { path: '/characters/raw/Victory.fbx', state: AnimState.Victory },
};

// Extra animations loaded for variety — can be swapped in per-class
export const EXTRA_ANIMS: Record<string, string> = {
  hookCombo: '/characters/raw/Hook.fbx',
  fistFight: '/characters/raw/Fist Fight A.fbx',
  rollKick: '/characters/raw/Roll Kicking.fbx',
  roundhouseAlt: '/characters/raw/Roundhouse Kicking.fbx',
  uppercut: '/characters/raw/Receiving A Big Uppercut.fbx',
  takingPunch: '/characters/raw/Taking Punch.fbx',
  outwardBlock: '/characters/raw/Outward Block.fbx',
  dodgeWalk: '/characters/raw/Dodging walk.fbx',
  jumpDown: '/characters/raw/Jumping Down.fbx',
  runRoll: '/characters/raw/Running and rolling.fbx',
  victoryAlt: '/characters/raw/Victoryy.fbx',
  standUp: '/characters/raw/standing Up.fbx',
  reaction: '/characters/raw/Reaction.fbx',
};

const loadedClips: Map<string, THREE.AnimationClip> = new Map();
const extraClips: Map<string, THREE.AnimationClip> = new Map();
let loadingPromise: Promise<void> | null = null;

function retargetClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  for (const track of clip.tracks) {
    track.name = track.name.replace(/^mixamorig(\w)/, (_, first) => {
      return 'mixamorig:' + first.toUpperCase();
    });
  }
  return clip;
}

export async function loadMixamoAnimations(): Promise<Map<string, THREE.AnimationClip>> {
  if (loadedClips.size > 0) return loadedClips;
  if (loadingPromise) {
    await loadingPromise;
    return loadedClips;
  }

  loadingPromise = (async () => {
    const loader = new FBXLoader();

    // Load primary animations
    const entries = Object.entries(MIXAMO_ANIMS);
    console.log(`[MixamoLoader] Loading ${entries.length} primary animations...`);

    await Promise.allSettled(
      entries.map(async ([key, { path, state }]) => {
        try {
          const group = await loader.loadAsync(path);
          if (group.animations.length > 0) {
            const clip = retargetClip(group.animations[0]);
            clip.name = state;
            loadedClips.set(state, clip);
          }
        } catch (e) {
          console.warn(`[MixamoLoader] Failed: ${key} — ${(e as Error).message}`);
        }
      })
    );

    console.log(`[MixamoLoader] Primary: ${loadedClips.size}/${entries.length}`);

    // Load extras in background (non-blocking)
    const extraEntries = Object.entries(EXTRA_ANIMS);
    Promise.allSettled(
      extraEntries.map(async ([key, path]) => {
        try {
          const group = await loader.loadAsync(path);
          if (group.animations.length > 0) {
            const clip = retargetClip(group.animations[0]);
            clip.name = `extra_${key}`;
            extraClips.set(key, clip);
          }
        } catch {}
      })
    ).then(() => {
      console.log(`[MixamoLoader] Extras: ${extraClips.size}/${extraEntries.length}`);
    });
  })();

  await loadingPromise;
  return loadedClips;
}

export function getMixamoClips(): Map<string, THREE.AnimationClip> {
  return loadedClips;
}

export function getExtraClips(): Map<string, THREE.AnimationClip> {
  return extraClips;
}

export function applyMixamoToMixer(
  mixer: THREE.AnimationMixer,
  existingClips: THREE.AnimationClip[]
): THREE.AnimationClip[] {
  const combined = [...existingClips];

  for (const [name, clip] of loadedClips) {
    const exists = combined.find(c => c.name === name);
    if (!exists) {
      combined.push(clip);
    }
  }

  return combined;
}
