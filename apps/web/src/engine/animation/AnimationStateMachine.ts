import * as THREE from 'three';

export enum AnimState {
  Idle = 'idle',
  Walk = 'walk',
  Run = 'run',
  LightAttack = 'lightAttack',
  HeavyAttack = 'heavyAttack',
  Special = 'special',
  Block = 'block',
  BlockHit = 'blockHit',
  Dodge = 'dodge',
  HitLight = 'hitLight',
  HitHeavy = 'hitHeavy',
  Knockdown = 'knockdown',
  GetUp = 'getUp',
  Death = 'death',
  Victory = 'victory',
  Intro = 'intro',
}

interface AnimStateConfig {
  clip: string;
  loop: boolean;
  speed: number;
  fadeIn: number;
  fadeOut: number;
  duration?: number;
  canInterrupt: boolean;
  nextState?: AnimState;
  onComplete?: () => void;
}

export interface AnimationMap {
  [state: string]: AnimStateConfig;
}

// Each state maps to its own clip name (set by MixamoLoader)
// Falls back to original GLB clips (idle/attack/hit/death) if Mixamo not loaded
const VALOR_ANIMS: AnimationMap = {
  [AnimState.Idle]: { clip: AnimState.Idle, loop: true, speed: 1, fadeIn: 0.2, fadeOut: 0.2, canInterrupt: true },
  [AnimState.Walk]: { clip: AnimState.Walk, loop: true, speed: 1, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.Run]: { clip: AnimState.Run, loop: true, speed: 1, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.LightAttack]: { clip: AnimState.LightAttack, loop: false, speed: 1.2, fadeIn: 0.08, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: AnimState.HeavyAttack, loop: false, speed: 1, fadeIn: 0.08, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]: { clip: AnimState.Special, loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]: { clip: AnimState.Block, loop: true, speed: 1, fadeIn: 0.1, fadeOut: 0.1, canInterrupt: true },
  [AnimState.BlockHit]: { clip: AnimState.HitLight, loop: false, speed: 1.5, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Dodge]: { clip: AnimState.Dodge, loop: false, speed: 1.2, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]: { clip: AnimState.HitLight, loop: false, speed: 1.2, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]: { clip: AnimState.HitHeavy, loop: false, speed: 1, fadeIn: 0.05, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Knockdown]: { clip: AnimState.HitHeavy, loop: false, speed: 0.8, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.GetUp },
  [AnimState.GetUp]: { clip: AnimState.GetUp, loop: false, speed: 1, fadeIn: 0.15, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Death]: { clip: AnimState.Death, loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0, canInterrupt: false },
  [AnimState.Victory]: { clip: AnimState.Victory, loop: false, speed: 1, fadeIn: 0.2, fadeOut: 0, canInterrupt: false },
  [AnimState.Intro]: { clip: AnimState.Idle, loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
};

export const CLASS_ANIMATIONS: Record<string, AnimationMap> = {
  berserker: VALOR_ANIMS,
  sentinel: VALOR_ANIMS,
  phantom: VALOR_ANIMS,
};

export class AnimationStateMachine {
  private currentState: AnimState = AnimState.Idle;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: Map<string, THREE.AnimationClip> = new Map();
  private activeAction: THREE.AnimationAction | null = null;
  private animMap: AnimationMap;
  private onStateChange?: (from: AnimState, to: AnimState) => void;
  private paused = false;

  constructor(animMap: AnimationMap) {
    this.animMap = animMap;
  }

  init(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]) {
    this.mixer = mixer;
    mixer.stopAllAction();
    this.activeAction = null;
    this.currentState = AnimState.Idle;
    this.clips.clear();
    for (const clip of clips) {
      this.clips.set(clip.name, clip);
    }
    this.transition(AnimState.Idle, true);
  }

  get state(): AnimState {
    return this.currentState;
  }

  setOnStateChange(cb: (from: AnimState, to: AnimState) => void) {
    this.onStateChange = cb;
  }

  transition(newState: AnimState, force = false) {
    if (!this.mixer) return;

    if (newState === this.currentState && !force) return;

    const currentConfig = this.animMap[this.currentState];
    if (currentConfig && !currentConfig.canInterrupt && !force) {
      if (this.activeAction && this.activeAction.isRunning()) return;
    }

    const config = this.animMap[newState];
    if (!config) return;

    let clip = this.clips.get(config.clip);
    // Fallback: if Mixamo clip not loaded yet, try GLB's generic clips
    if (!clip) {
      const fallbacks: Record<string, string> = {
        walk: 'idle', run: 'idle',
        lightAttack: 'attack', heavyAttack: 'attack', special: 'attack',
        block: 'idle', dodge: 'idle',
        hitLight: 'hit', hitHeavy: 'hit', knockdown: 'hit',
        getUp: 'idle', victory: 'idle',
      };
      const fb = fallbacks[config.clip];
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

    if (this.activeAction && this.activeAction !== newAction) {
      this.activeAction.fadeOut(config.fadeIn);
    }

    newAction.reset().fadeIn(config.fadeIn).play();
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
    this.mixer.update(dt);
  }

  pause() {
    this.paused = true;
    if (this.mixer) this.mixer.timeScale = 0;
  }

  resume() {
    this.paused = false;
    if (this.mixer) this.mixer.timeScale = 1;
  }

  setTimeScale(scale: number) {
    if (this.mixer) this.mixer.timeScale = scale;
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
