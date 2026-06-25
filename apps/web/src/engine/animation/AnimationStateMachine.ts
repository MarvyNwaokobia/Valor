import * as THREE from 'three';
import { CLIP_NAMES, getClipStride } from './MixamoLoader';

// Mixamo clips are authored in centimetres; the fighters live in a metre-scaled
// world. So a clip's baked ground speed (clip-units/sec) divided by this is its
// real-world m/s. (Confirmed empirically: walk ≈ 1.79 m/s, run ≈ 4.75 m/s.)
const MIXAMO_UNITS_PER_METER = 100;
// Below this baked speed (clip-units/sec) a clip is treated as in-place — too
// little travel to lock a cadence to, so we fall back to its authored speed.
const MIN_BAKED_STRIDE = 1;
// Hip height (m) of the Mixamo reference skeleton the clips were authored on.
// A taller rig's longer legs sweep proportionally more ground per stride, so we
// scale the baked speed by (this rig's hip height / reference) to keep feet
// planted across differently-sized fighters.
const REF_HIP_HEIGHT_M = 1.0;

// The shooter's complete state set — exactly the states the stat-duel drives.
// (Melee states, crit-knockdown and get-up were retired with the fighter→shooter
// pivot; a crit now reads as a heavy flinch.)
export enum AnimState {
  Idle = 'idle',
  Walk = 'walk',
  Run = 'run',
  Fire = 'fire',
  Dodge = 'dodge',
  HitLight = 'hitLight',
  HitHeavy = 'hitHeavy',
  Death = 'death',
  Victory = 'victory',
}

export type HitDirection = 'front' | 'back' | 'side';

interface AnimStateConfig {
  clip: string;
  // Optional pool of alternate clips for this state. When present, the machine
  // picks one per entry so the move "switches up" instead of repeating:
  //   'chain'  → cycle through the pool across a combo (jab → cross → hook),
  //              resetting after a pause so isolated hits start fresh.
  //   'random' → pick at random (varied hit reactions, dodges, etc.).
  clips?: string[];
  variant?: 'chain' | 'random';
  // Hit reactions can pick a pool by where the blow landed (front/back/side).
  clipsByDir?: { front?: string[]; back?: string[]; side?: string[] };
  loop: boolean;
  speed: number;
  fadeIn: number;
  fadeOut: number;
  duration?: number;
  canInterrupt: boolean;
  nextState?: AnimState;
  onComplete?: () => void;
}

// Safety reset (seconds) for the combo-chain cursor — matched to the combo window
// (ComboSystem COMBO_WINDOW = 0.8). The chain is primarily gated on whether an
// attack is an actual cancel (see resolveClipName's `comboChain`); this only
// catches a stray cancel after a long gap. Measured on the game clock (`clockSec`),
// so it freezes with everything else during hitstop.
const CHAIN_RESET_SEC = 0.8;

export interface AnimationMap {
  [state: string]: AnimStateConfig;
}

// Clean shooter animation set — ONE clip per state the stat-duel actually drives
// (idle / walk / run / dodge + light-flinch / heavy-flinch / crit-knockdown / get-up
// + death / victory). Fire is injected below. The melee states left on the AnimState
// enum (LightAttack/Block/Jump/…) are never triggered in the shooter, so they carry
// no config — transition() simply no-ops if one is ever requested.
//
// Per-class flavour is just timing: Berserker leans heavier/slower, Phantom snappier,
// Sentinel even. The clips themselves are shared so every fighter reads consistently.
function buildAnimMap(tempo: number): AnimationMap {
  return {
    [AnimState.Idle]:      { clip: CLIP_NAMES.rifleIdle,    loop: true,  speed: tempo,        fadeIn: 0.2,  fadeOut: 0.2,  canInterrupt: true },
    [AnimState.Walk]:      { clip: CLIP_NAMES.walk,         loop: true,  speed: 1.0,          fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
    [AnimState.Run]:       { clip: CLIP_NAMES.run,          loop: true,  speed: 1.0 * tempo,  fadeIn: 0.12, fadeOut: 0.12, canInterrupt: true },
    [AnimState.Dodge]:     { clip: CLIP_NAMES.dodge,        loop: false, speed: 1.3,          fadeIn: 0.05, fadeOut: 0.12, duration: 0.5, canInterrupt: false, nextState: AnimState.Idle },
    [AnimState.HitLight]:  { clip: CLIP_NAMES.hitReaction,  loop: false, speed: 1.3,          fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
    [AnimState.HitHeavy]:  { clip: CLIP_NAMES.gettingHit,   loop: false, speed: 1.0,          fadeIn: 0.04, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
    [AnimState.Death]:     { clip: CLIP_NAMES.deathForward, loop: false, speed: 1.0,          fadeIn: 0.08, fadeOut: 0,    canInterrupt: false },
    [AnimState.Victory]:   { clip: CLIP_NAMES.victory,      loop: false, speed: 1.0,          fadeIn: 0.2,  fadeOut: 0,    canInterrupt: false },
  };
}

export const CLASS_ANIMATIONS: Record<string, AnimationMap> = {
  berserker: buildAnimMap(0.9),  // heavy, deliberate
  sentinel:  buildAnimMap(1.0),  // balanced
  phantom:   buildAnimMap(1.1),  // fast, agile
};

// The Fire clip is class-agnostic (the gun stance is shared), so inject one config
// into every class map. Played one-shot on each `fire` sim event, returning to the
// rifle Idle. canInterrupt so movement/dodge can override it.
const FIRE_CONFIG: AnimStateConfig = {
  clip: CLIP_NAMES.gunplayShooting,
  loop: false, speed: 1.0, fadeIn: 0.04, fadeOut: 0.08,
  canInterrupt: true, nextState: AnimState.Idle,
};
for (const map of Object.values(CLASS_ANIMATIONS)) {
  map[AnimState.Fire] = FIRE_CONFIG;
}

export class AnimationStateMachine {
  private currentState: AnimState = AnimState.Idle;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: Map<string, THREE.AnimationClip> = new Map();
  private activeAction: THREE.AnimationAction | null = null;
  private animMap: AnimationMap;
  private onStateChange?: (from: AnimState, to: AnimState) => void;
  private paused = false;
  private pendingTransition: { state: AnimState; force: boolean; dir?: HitDirection; comboChain?: boolean } | null = null;
  private previousAction: THREE.AnimationAction | null = null;
  // Combo-chain cursor for 'chain' variant pools (shared across attack states so
  // a light→heavy string keeps advancing), reset after a lull between hits.
  private chainIndex = 0;
  private lastChainTime = 0;
  // This fighter's hip height ÷ reference, so locomotion cadence accounts for
  // leg length (set once the rig is bound; 1 = same size as the clip's rig).
  private rigScale = 1;
  // Accumulated game time (seconds), advanced by `update` only while unpaused, so
  // it freezes during hitstop. Single clock for all time-based animation logic.
  private clockSec = 0;

  constructor(animMap: AnimationMap) {
    this.animMap = animMap;
  }

  init(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]) {
    this.mixer = mixer;
    mixer.stopAllAction();
    this.activeAction = null;
    this.previousAction = null;
    this.currentState = AnimState.Idle;
    this.chainIndex = 0;
    this.lastChainTime = 0;
    this.clockSec = 0;
    this.clips.clear();
    for (const clip of clips) {
      this.clips.set(clip.name, clip);
    }
    this.transition(AnimState.Idle, true);
  }

  // Picks which clip a state plays this entry: a directional reaction, a fixed
  // clip, the next in a combo chain, or a random variant — so moves and
  // reactions stop looking identical.
  //
  // `comboChain` gates the 'chain' variety: a STANDALONE attack (a fresh press,
  // not a cancel) always plays the base clip (pool[0]) and re-arms the chain, so
  // single-tapping Light reads as one consistent move. Only a confirmed cancel
  // advances through the pool, so the jab→cross→hook→kick variety appears only
  // inside an actual combo string.
  private resolveClipName(config: AnimStateConfig, dir?: HitDirection, comboChain = false): string {
    if (dir && config.clipsByDir) {
      const pool = config.clipsByDir[dir] ?? config.clipsByDir.front;
      if (pool && pool.length > 0) {
        return pool[Math.floor(Math.random() * pool.length)];
      }
    }

    const pool = config.clips;
    if (!pool || pool.length === 0) return config.clip;
    if (pool.length === 1) return pool[0];

    if (config.variant === 'chain') {
      // Fresh attack, or a cancel after a long gap → restart the string at pool[0].
      if (!comboChain || this.clockSec - this.lastChainTime > CHAIN_RESET_SEC) {
        this.chainIndex = 0;
      }
      this.lastChainTime = this.clockSec;
      return pool[this.chainIndex++ % pool.length];
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }

  get state(): AnimState {
    return this.currentState;
  }

  /** Name of the clip currently playing (which chain/random variant was picked). */
  get currentClipName(): string | null {
    return this.activeAction?.getClip().name ?? null;
  }

  setOnStateChange(cb: (from: AnimState, to: AnimState) => void) {
    this.onStateChange = cb;
  }

  // Force a directional hit reaction (front/back/side picks the clip pool).
  transitionHit(newState: AnimState, dir: HitDirection) {
    this.transition(newState, true, dir);
  }

  transition(newState: AnimState, force = false, dir?: HitDirection, comboChain = false) {
    if (!this.mixer) return;

    if (this.paused) {
      this.pendingTransition = { state: newState, force, dir, comboChain };
      return;
    }

    if (newState === this.currentState && !force) return;

    const currentConfig = this.animMap[this.currentState];
    if (currentConfig && !currentConfig.canInterrupt && !force) {
      if (this.activeAction && this.activeAction.isRunning()) return;
    }

    const config = this.animMap[newState];
    if (!config) return;

    let clip = this.clips.get(this.resolveClipName(config, dir, comboChain));
    if (!clip) {
      const stateToGlb: Record<string, string> = {
        [AnimState.Idle]: 'idle', [AnimState.Walk]: 'idle', [AnimState.Run]: 'idle',
        [AnimState.Fire]: 'attack', [AnimState.Dodge]: 'idle',
        [AnimState.HitLight]: 'hit', [AnimState.HitHeavy]: 'hit',
        [AnimState.Victory]: 'idle', [AnimState.Death]: 'death',
      };
      const fb = stateToGlb[newState];
      if (fb) clip = this.clips.get(fb);
    }
    if (!clip) return;

    const prevState = this.currentState;
    this.currentState = newState;

    const newAction = this.mixer.clipAction(clip);
    newAction.setLoop(
      config.loop ? THREE.LoopRepeat : THREE.LoopOnce,
      config.loop ? Infinity : 1
    );
    newAction.clampWhenFinished = !config.loop;
    newAction.timeScale = config.speed;

    if (config.duration) {
      newAction.setDuration(config.duration);
    }

    // Stop lingering action from a prior transition to prevent
    // three-way blends where total weight < 1 → T-pose bleed
    if (this.previousAction && this.previousAction !== this.activeAction && this.previousAction !== newAction) {
      this.previousAction.stop();
    }
    this.previousAction = this.activeAction;

    if (this.activeAction && this.activeAction !== newAction) {
      this.activeAction.fadeOut(config.fadeIn);
      newAction.reset().fadeIn(config.fadeIn).play();
    } else {
      // No active action to crossfade with — play at full weight immediately
      newAction.reset().setEffectiveWeight(1).play();
    }
    this.activeAction = newAction;

    if (!config.loop) {
      const onFinished = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== newAction) return;
        this.mixer!.removeEventListener('finished', onFinished);
        config.onComplete?.();
        if (config.nextState) {
          this.transition(config.nextState, true);
        }
      };
      this.mixer.addEventListener('finished', onFinished);
    }

    this.onStateChange?.(prevState, newState);
  }

  update(dt: number) {
    if (this.paused || !this.mixer) return;
    this.clockSec += dt;
    this.mixer.update(dt);
  }

  // Normalized progress (0..1) of the current action through its clip.
  // Because it reads action.time directly, it is in clip-local seconds and
  // therefore independent of playback speed, AND frozen while the mixer is
  // paused for hitstop — making it the single clock all combat hangs off.
  getActiveProgress(): number {
    if (!this.activeAction) return 1;
    const clip = this.activeAction.getClip();
    const dur = clip?.duration ?? 0;
    if (dur <= 0) return 1;
    return Math.min(1, Math.max(0, this.activeAction.time / dur));
  }

  // Record the bound rig's hip height (metres) so locomotion cadence accounts
  // for leg length — a taller fighter covers more ground per stride.
  setRigScale(hipHeightMeters: number) {
    if (hipHeightMeters > 0.1) {
      this.rigScale = Math.min(2, Math.max(0.5, hipHeightMeters / REF_HIP_HEIGHT_M));
    }
  }

  // Lock the walk/run cycle cadence to the fighter's real ground speed so the
  // planted foot stays put instead of skating. Root motion is stripped (the body
  // is moved by code), so we drive timeScale from the clip's MEASURED baked
  // stride: at timeScale = worldSpeed / bakedSpeed the legs cover exactly the
  // ground the body travels. Beats a hand-guessed reference, and self-corrects
  // for partial-speed (analog/touch) movement and the walk→run handoff.
  matchLocomotionSpeed(worldSpeed: number) {
    if (!this.activeAction || this.paused) return;
    const s = this.currentState;
    if (s !== AnimState.Walk && s !== AnimState.Run) return;

    const stride = getClipStride(this.activeAction.getClip().name);
    if (stride && stride.groundSpeed > MIN_BAKED_STRIDE) {
      const bakedWorldSpeed = (stride.groundSpeed / MIXAMO_UNITS_PER_METER) * this.rigScale;
      this.activeAction.timeScale = Math.min(1.7, Math.max(0.55, worldSpeed / bakedWorldSpeed));
    } else {
      // In-place clip — no baked travel to match; play at its authored speed.
      this.activeAction.timeScale = this.animMap[s]?.speed ?? 1;
    }
  }

  pause() {
    this.paused = true;
    if (this.mixer) this.mixer.timeScale = 0;
  }

  resume() {
    this.paused = false;
    if (this.mixer) this.mixer.timeScale = 1;
    if (this.pendingTransition) {
      const { state, dir, comboChain } = this.pendingTransition;
      this.pendingTransition = null;
      // Clean slate after freeze — stop everything so transition()
      // plays the new clip at full weight with no stale crossfades
      this.mixer?.stopAllAction();
      this.activeAction = null;
      this.previousAction = null;
      this.transition(state, true, dir, comboChain);
    }
  }

  setTimeScale(scale: number) {
    if (this.mixer) this.mixer.timeScale = scale;
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
