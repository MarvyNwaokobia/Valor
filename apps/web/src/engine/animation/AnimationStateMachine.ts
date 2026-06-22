import * as THREE from 'three';
import { CLIP_NAMES } from './MixamoLoader';

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

// --- Berserker: heavy, brutal, raw power ---
const BERSERKER_ANIMS: AnimationMap = {
  [AnimState.Idle]:        { clip: CLIP_NAMES.fightIdle,     loop: true,  speed: 0.9,  fadeIn: 0.2,  fadeOut: 0.2,  canInterrupt: true },
  [AnimState.Walk]:        { clip: CLIP_NAMES.walk,          loop: true,  speed: 1.0,  fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.Run]:         { clip: CLIP_NAMES.run,           loop: true,  speed: 1.1,  fadeIn: 0.12, fadeOut: 0.12, canInterrupt: true },
  [AnimState.LightAttack]: { clip: CLIP_NAMES.fistFight,     loop: false, speed: 1.3,  fadeIn: 0.06, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: CLIP_NAMES.hook,          loop: false, speed: 0.9,  fadeIn: 0.06, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]:     { clip: CLIP_NAMES.roundhouseKick,loop: false, speed: 0.85, fadeIn: 0.08, fadeOut: 0.2,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]:       { clip: CLIP_NAMES.bodyBlock,     loop: true,  speed: 1.0,  fadeIn: 0.08, fadeOut: 0.08, canInterrupt: true },
  [AnimState.BlockHit]:    { clip: CLIP_NAMES.takingPunch,   loop: false, speed: 1.4,  fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Dodge]:       { clip: CLIP_NAMES.jumpDown,      loop: false, speed: 1.3,  fadeIn: 0.05, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]:    { clip: CLIP_NAMES.takingPunch,   loop: false, speed: 1.3,  fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]:    { clip: CLIP_NAMES.uppercut,      loop: false, speed: 1.0,  fadeIn: 0.04, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Knockdown]:   { clip: CLIP_NAMES.shoulderFall,  loop: false, speed: 0.8,  fadeIn: 0.08, fadeOut: 0.2,  canInterrupt: false, nextState: AnimState.GetUp },
  [AnimState.GetUp]:       { clip: CLIP_NAMES.gettingUpAlt,  loop: false, speed: 1.0,  fadeIn: 0.12, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Death]:       { clip: CLIP_NAMES.deathForward,  loop: false, speed: 0.9,  fadeIn: 0.08, fadeOut: 0,    canInterrupt: false },
  [AnimState.Victory]:     { clip: CLIP_NAMES.victory,       loop: false, speed: 1.0,  fadeIn: 0.2,  fadeOut: 0,    canInterrupt: false },
  [AnimState.Intro]:       { clip: CLIP_NAMES.fightIdle,     loop: false, speed: 1.0,  fadeIn: 0.1,  fadeOut: 0.2,  canInterrupt: false, nextState: AnimState.Idle },
};

// --- Phantom: fast, agile, acrobatic ---
const PHANTOM_ANIMS: AnimationMap = {
  [AnimState.Idle]:        { clip: CLIP_NAMES.fightIdle,      loop: true,  speed: 1.1,  fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.Walk]:        { clip: CLIP_NAMES.dodgeWalk,      loop: true,  speed: 1.0,  fadeIn: 0.12, fadeOut: 0.12, canInterrupt: true },
  [AnimState.Run]:         { clip: CLIP_NAMES.run,            loop: true,  speed: 1.2,  fadeIn: 0.1,  fadeOut: 0.1,  canInterrupt: true },
  [AnimState.LightAttack]: { clip: CLIP_NAMES.jabCross,       loop: false, speed: 1.5,  fadeIn: 0.04, fadeOut: 0.1,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: CLIP_NAMES.roundhouseAlt,  loop: false, speed: 1.1,  fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]:     { clip: CLIP_NAMES.rollKick,       loop: false, speed: 1.0,  fadeIn: 0.06, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]:       { clip: CLIP_NAMES.outwardBlock,   loop: true,  speed: 1.0,  fadeIn: 0.06, fadeOut: 0.06, canInterrupt: true },
  [AnimState.BlockHit]:    { clip: CLIP_NAMES.reaction,       loop: false, speed: 1.5,  fadeIn: 0.03, fadeOut: 0.1,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Dodge]:       { clip: CLIP_NAMES.runRoll,        loop: false, speed: 1.4,  fadeIn: 0.04, fadeOut: 0.1,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]:    { clip: CLIP_NAMES.reaction,       loop: false, speed: 1.4,  fadeIn: 0.03, fadeOut: 0.1,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]:    { clip: CLIP_NAMES.hitReactionAlt, loop: false, speed: 1.1,  fadeIn: 0.04, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Knockdown]:   { clip: CLIP_NAMES.shoulderFall,   loop: false, speed: 0.9,  fadeIn: 0.06, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.GetUp },
  [AnimState.GetUp]:       { clip: CLIP_NAMES.gettingUp,      loop: false, speed: 1.2,  fadeIn: 0.1,  fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Death]:       { clip: CLIP_NAMES.deathForward,   loop: false, speed: 1.0,  fadeIn: 0.06, fadeOut: 0,    canInterrupt: false },
  [AnimState.Victory]:     { clip: CLIP_NAMES.victoryAlt,     loop: false, speed: 1.0,  fadeIn: 0.15, fadeOut: 0,    canInterrupt: false },
  [AnimState.Intro]:       { clip: CLIP_NAMES.fightIdle,      loop: false, speed: 1.0,  fadeIn: 0.1,  fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
};

// --- Sentinel: balanced, defensive, deliberate ---
const SENTINEL_ANIMS: AnimationMap = {
  [AnimState.Idle]:        { clip: CLIP_NAMES.fightIdle,      loop: true,  speed: 1.0,  fadeIn: 0.2,  fadeOut: 0.2,  canInterrupt: true },
  [AnimState.Walk]:        { clip: CLIP_NAMES.walk,           loop: true,  speed: 0.95, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.Run]:         { clip: CLIP_NAMES.run,            loop: true,  speed: 1.0,  fadeIn: 0.12, fadeOut: 0.12, canInterrupt: true },
  [AnimState.LightAttack]: { clip: CLIP_NAMES.jabCross,       loop: false, speed: 1.2,  fadeIn: 0.06, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: CLIP_NAMES.hookPunch,      loop: false, speed: 1.0,  fadeIn: 0.06, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]:     { clip: CLIP_NAMES.roundhouseAlt,  loop: false, speed: 0.9,  fadeIn: 0.08, fadeOut: 0.2,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]:       { clip: CLIP_NAMES.outwardBlock,   loop: true,  speed: 1.0,  fadeIn: 0.06, fadeOut: 0.06, canInterrupt: true },
  [AnimState.BlockHit]:    { clip: CLIP_NAMES.hitReaction,    loop: false, speed: 1.3,  fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Dodge]:       { clip: CLIP_NAMES.dodge,          loop: false, speed: 1.2,  fadeIn: 0.05, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]:    { clip: CLIP_NAMES.hitReaction,    loop: false, speed: 1.2,  fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]:    { clip: CLIP_NAMES.gettingHit,     loop: false, speed: 1.0,  fadeIn: 0.04, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Knockdown]:   { clip: CLIP_NAMES.shoulderFall,   loop: false, speed: 0.85, fadeIn: 0.08, fadeOut: 0.2,  canInterrupt: false, nextState: AnimState.GetUp },
  [AnimState.GetUp]:       { clip: CLIP_NAMES.standUp,        loop: false, speed: 1.0,  fadeIn: 0.12, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Death]:       { clip: CLIP_NAMES.deathForward,   loop: false, speed: 1.0,  fadeIn: 0.08, fadeOut: 0,    canInterrupt: false },
  [AnimState.Victory]:     { clip: CLIP_NAMES.victory,        loop: false, speed: 1.0,  fadeIn: 0.2,  fadeOut: 0,    canInterrupt: false },
  [AnimState.Intro]:       { clip: CLIP_NAMES.fightIdle,      loop: false, speed: 1.0,  fadeIn: 0.1,  fadeOut: 0.2,  canInterrupt: false, nextState: AnimState.Idle },
};

export const CLASS_ANIMATIONS: Record<string, AnimationMap> = {
  berserker: BERSERKER_ANIMS,
  sentinel: SENTINEL_ANIMS,
  phantom: PHANTOM_ANIMS,
};

export class AnimationStateMachine {
  private currentState: AnimState = AnimState.Idle;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: Map<string, THREE.AnimationClip> = new Map();
  private activeAction: THREE.AnimationAction | null = null;
  private animMap: AnimationMap;
  private onStateChange?: (from: AnimState, to: AnimState) => void;
  private paused = false;
  private pendingTransition: { state: AnimState; force: boolean } | null = null;
  private previousAction: THREE.AnimationAction | null = null;

  constructor(animMap: AnimationMap) {
    this.animMap = animMap;
  }

  init(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]) {
    this.mixer = mixer;
    mixer.stopAllAction();
    this.activeAction = null;
    this.previousAction = null;
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

    if (this.paused) {
      this.pendingTransition = { state: newState, force };
      return;
    }

    if (newState === this.currentState && !force) return;

    const currentConfig = this.animMap[this.currentState];
    if (currentConfig && !currentConfig.canInterrupt && !force) {
      if (this.activeAction && this.activeAction.isRunning()) return;
    }

    const config = this.animMap[newState];
    if (!config) return;

    let clip = this.clips.get(config.clip);
    if (!clip) {
      const stateToGlb: Record<string, string> = {
        [AnimState.Idle]: 'idle', [AnimState.Walk]: 'idle', [AnimState.Run]: 'idle',
        [AnimState.LightAttack]: 'attack', [AnimState.HeavyAttack]: 'attack', [AnimState.Special]: 'attack',
        [AnimState.Block]: 'idle', [AnimState.Dodge]: 'idle',
        [AnimState.HitLight]: 'hit', [AnimState.HitHeavy]: 'hit', [AnimState.Knockdown]: 'hit',
        [AnimState.BlockHit]: 'hit', [AnimState.GetUp]: 'idle',
        [AnimState.Victory]: 'idle', [AnimState.Intro]: 'idle',
        [AnimState.Death]: 'death',
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
    this.mixer.update(dt);
  }

  pause() {
    this.paused = true;
    if (this.mixer) this.mixer.timeScale = 0;
  }

  resume() {
    this.paused = false;
    if (this.mixer) this.mixer.timeScale = 1;
    if (this.pendingTransition) {
      const { state } = this.pendingTransition;
      this.pendingTransition = null;
      // Clean slate after freeze — stop everything so transition()
      // plays the new clip at full weight with no stale crossfades
      this.mixer?.stopAllAction();
      this.activeAction = null;
      this.previousAction = null;
      this.transition(state, true);
    }
  }

  setTimeScale(scale: number) {
    if (this.mixer) this.mixer.timeScale = scale;
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
