import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { AnimState } from './AnimationStateMachine';

const MIXAMO_ANIMS: Record<string, { path: string; state: AnimState }> = {
  walk: { path: '/characters/raw/Walking.fbx', state: AnimState.Walk },
  run: { path: '/characters/raw/Running.fbx', state: AnimState.Run },
  fightIdle: { path: '/characters/raw/Fighting Idle.fbx', state: AnimState.Idle },
  lightAttack: { path: '/characters/raw/Jab Cross.fbx', state: AnimState.LightAttack },
  heavyAttack: { path: '/characters/raw/Hook Punch.fbx', state: AnimState.HeavyAttack },
  special: { path: '/characters/raw/Roundhouse Kick.fbx', state: AnimState.Special },
  block: { path: '/characters/raw/Body Block.fbx', state: AnimState.Block },
  dodge: { path: '/characters/raw/Dodging.fbx', state: AnimState.Dodge },
  hitLight: { path: '/characters/raw/Hit Reaction.fbx', state: AnimState.HitLight },
  hitHeavy: { path: '/characters/raw/Getting Hit.fbx', state: AnimState.HitHeavy },
  death: { path: '/characters/raw/Standing Death Forward 02.fbx', state: AnimState.Death },
  victory: { path: '/characters/raw/Victory.fbx', state: AnimState.Victory },
  getUp: { path: '/characters/raw/Getting Up.fbx', state: AnimState.GetUp },
};

const loadedClips: Map<string, THREE.AnimationClip> = new Map();
let loadingPromise: Promise<void> | null = null;

function retargetClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  for (const track of clip.tracks) {
    // FBX exports: "mixamorigHips.position"
    // GLB expects: "mixamorig:Hips.position"
    track.name = track.name.replace(/^mixamorig(\w)/, (_, first) => {
      return 'mixamorig:' + first.toUpperCase();
    });
    // Handle nested bones: "mixamorigLeftForeArm" → "mixamorig:LeftForeArm"
    // The regex above handles this since it captures the first char after "mixamorig"
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
    const entries = Object.entries(MIXAMO_ANIMS);

    console.log(`[MixamoLoader] Loading ${entries.length} animations...`);

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
          console.warn(`[MixamoLoader] Failed to load ${key}: ${(e as Error).message}`);
        }
      })
    );

    console.log(`[MixamoLoader] Loaded ${loadedClips.size}/${entries.length} animations`);
    const sampleClip = loadedClips.values().next().value;
    if (sampleClip) {
      console.log(`[MixamoLoader] Sample track names: ${sampleClip.tracks.slice(0, 3).map((t: any) => t.name).join(', ')}`);
    }
  })();

  await loadingPromise;
  return loadedClips;
}

export function getMixamoClips(): Map<string, THREE.AnimationClip> {
  return loadedClips;
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
