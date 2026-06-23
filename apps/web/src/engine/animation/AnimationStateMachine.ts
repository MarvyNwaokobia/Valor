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

// How long a gap (ms) between attacks before the chain restarts from the top.
const CHAIN_RESET_MS = 1200;

export interface AnimationMap {
  [state: string]: AnimStateConfig;
}

// --- Berserker: heavy, brutal, raw power ---
const BERSERKER_ANIMS: AnimationMap = {
  [AnimState.Idle]:        { clip: CLIP_NAMES.fightIdle,     loop: true,  speed: 0.9,  fadeIn: 0.2,  fadeOut: 0.2,  canInterrupt: true },
  [AnimState.Walk]:        { clip: CLIP_NAMES.walk,          loop: true,  speed: 1.0,  fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.Run]:         { clip: CLIP_NAMES.run,           loop: true,  speed: 1.1,  fadeIn: 0.12, fadeOut: 0.12, canInterrupt: true },
  // Light mash flows as a brawler flurry; heavy alternates big swings.
  [AnimState.LightAttack]: { clip: CLIP_NAMES.fistFight,     clips: [CLIP_NAMES.fistFight, CLIP_NAMES.jabCross, CLIP_NAMES.hookPunch], variant: 'chain', loop: false, speed: 1.3,  fadeIn: 0.06, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: CLIP_NAMES.hook,          clips: [CLIP_NAMES.hook, CLIP_NAMES.roundhouseKick], variant: 'chain', loop: false, speed: 0.9,  fadeIn: 0.06, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]:     { clip: CLIP_NAMES.roundhouseKick,clips: [CLIP_NAMES.roundhouseKick, CLIP_NAMES.roundhouseAlt], variant: 'random', loop: false, speed: 0.85, fadeIn: 0.08, fadeOut: 0.2,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]:       { clip: CLIP_NAMES.bodyBlock,     loop: true,  speed: 1.0,  fadeIn: 0.08, fadeOut: 0.08, canInterrupt: true },
  [AnimState.BlockHit]:    { clip: CLIP_NAMES.takingPunch,   loop: false, speed: 1.4,  fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Block },
  // Dodge mixes a jump-back and a roll.
  [AnimState.Dodge]:       { clip: CLIP_NAMES.jumpDown,      clips: [CLIP_NAMES.jumpDown, CLIP_NAMES.runRoll], variant: 'random', loop: false, speed: 1.3,  fadeIn: 0.05, fadeOut: 0.12, duration: 0.5, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]:    { clip: CLIP_NAMES.takingPunch,   clipsByDir: { front: [CLIP_NAMES.takingPunch, CLIP_NAMES.hitReaction, CLIP_NAMES.reaction], back: [CLIP_NAMES.gettingHit, CLIP_NAMES.hitReactionAlt], side: [CLIP_NAMES.reaction, CLIP_NAMES.hitReactionAlt] }, variant: 'random', loop: false, speed: 1.3,  fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]:    { clip: CLIP_NAMES.uppercut,      clipsByDir: { front: [CLIP_NAMES.uppercut, CLIP_NAMES.takingPunch, CLIP_NAMES.gettingHit], back: [CLIP_NAMES.shoulderFall, CLIP_NAMES.gettingHit], side: [CLIP_NAMES.gettingHit, CLIP_NAMES.uppercut] }, loop: false, speed: 1.0,  fadeIn: 0.04, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
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
  [AnimState.LightAttack]: { clip: CLIP_NAMES.jabCross,       clips: [CLIP_NAMES.jabCross, CLIP_NAMES.fistFight, CLIP_NAMES.hookPunch], variant: 'chain', loop: false, speed: 1.5,  fadeIn: 0.04, fadeOut: 0.1,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: CLIP_NAMES.roundhouseAlt,  clips: [CLIP_NAMES.hookPunch, CLIP_NAMES.roundhouseAlt], variant: 'chain', loop: false, speed: 1.1,  fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]:     { clip: CLIP_NAMES.rollKick,       clips: [CLIP_NAMES.rollKick, CLIP_NAMES.roundhouseKick], variant: 'random', loop: false, speed: 1.0,  fadeIn: 0.06, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]:       { clip: CLIP_NAMES.outwardBlock,   loop: true,  speed: 1.0,  fadeIn: 0.06, fadeOut: 0.06, canInterrupt: true },
  [AnimState.BlockHit]:    { clip: CLIP_NAMES.reaction,       loop: false, speed: 1.5,  fadeIn: 0.03, fadeOut: 0.1,  canInterrupt: false, nextState: AnimState.Block },
  // Phantom favours rolls.
  [AnimState.Dodge]:       { clip: CLIP_NAMES.runRoll,        clips: [CLIP_NAMES.runRoll, CLIP_NAMES.dodge, CLIP_NAMES.jumpDown], variant: 'random', loop: false, speed: 1.4,  fadeIn: 0.04, fadeOut: 0.1,  duration: 0.5, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]:    { clip: CLIP_NAMES.reaction,       clipsByDir: { front: [CLIP_NAMES.reaction, CLIP_NAMES.hitReaction, CLIP_NAMES.hitReactionAlt], back: [CLIP_NAMES.hitReactionAlt, CLIP_NAMES.gettingHit], side: [CLIP_NAMES.hitReaction, CLIP_NAMES.hitReactionAlt] }, variant: 'random', loop: false, speed: 1.4,  fadeIn: 0.03, fadeOut: 0.1,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]:    { clip: CLIP_NAMES.hitReactionAlt, clipsByDir: { front: [CLIP_NAMES.uppercut, CLIP_NAMES.hitReactionAlt, CLIP_NAMES.gettingHit], back: [CLIP_NAMES.shoulderFall, CLIP_NAMES.gettingHit], side: [CLIP_NAMES.gettingHit, CLIP_NAMES.uppercut] }, loop: false, speed: 1.1,  fadeIn: 0.04, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
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
  [AnimState.LightAttack]: { clip: CLIP_NAMES.jabCross,       clips: [CLIP_NAMES.jabCross, CLIP_NAMES.hookPunch, CLIP_NAMES.fistFight], variant: 'chain', loop: false, speed: 1.2,  fadeIn: 0.06, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: CLIP_NAMES.hookPunch,      clips: [CLIP_NAMES.hook, CLIP_NAMES.roundhouseAlt], variant: 'chain', loop: false, speed: 1.0,  fadeIn: 0.06, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]:     { clip: CLIP_NAMES.roundhouseAlt,  clips: [CLIP_NAMES.roundhouseAlt, CLIP_NAMES.roundhouseKick], variant: 'random', loop: false, speed: 0.9,  fadeIn: 0.08, fadeOut: 0.2,  canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]:       { clip: CLIP_NAMES.outwardBlock,   loop: true,  speed: 1.0,  fadeIn: 0.06, fadeOut: 0.06, canInterrupt: true },
  [AnimState.BlockHit]:    { clip: CLIP_NAMES.hitReaction,    loop: false, speed: 1.3,  fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Block },
  [AnimState.Dodge]:       { clip: CLIP_NAMES.dodge,          clips: [CLIP_NAMES.dodge, CLIP_NAMES.runRoll], variant: 'random', loop: false, speed: 1.2,  fadeIn: 0.05, fadeOut: 0.12, duration: 0.5, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]:    { clip: CLIP_NAMES.hitReaction,    clipsByDir: { front: [CLIP_NAMES.hitReaction, CLIP_NAMES.takingPunch, CLIP_NAMES.reaction], back: [CLIP_NAMES.gettingHit, CLIP_NAMES.hitReactionAlt], side: [CLIP_NAMES.reaction, CLIP_NAMES.hitReaction] }, variant: 'random', loop: false, speed: 1.2,  fadeIn: 0.04, fadeOut: 0.12, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]:    { clip: CLIP_NAMES.gettingHit,     clipsByDir: { front: [CLIP_NAMES.gettingHit, CLIP_NAMES.uppercut, CLIP_NAMES.hitReactionAlt], back: [CLIP_NAMES.shoulderFall, CLIP_NAMES.gettingHit], side: [CLIP_NAMES.uppercut, CLIP_NAMES.gettingHit] }, loop: false, speed: 1.0,  fadeIn: 0.04, fadeOut: 0.18, canInterrupt: false, nextState: AnimState.Idle },
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
  private pendingTransition: { state: AnimState; force: boolean; dir?: HitDirection } | null = null;
  private previousAction: THREE.AnimationAction | null = null;
  // Combo-chain cursor for 'chain' variant pools (shared across attack states so
  // a light→heavy string keeps advancing), reset after a lull between hits.
  private chainIndex = 0;
  private lastChainTime = 0;

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
    this.clips.clear();
    for (const clip of clips) {
      this.clips.set(clip.name, clip);
    }
    this.transition(AnimState.Idle, true);
  }

  // Picks which clip a state plays this entry: a directional reaction, a fixed
  // clip, the next in a combo chain, or a random variant — so moves and
  // reactions stop looking identical.
  private resolveClipName(config: AnimStateConfig, dir?: HitDirection): string {
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
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this.lastChainTime > CHAIN_RESET_MS) this.chainIndex = 0;
      this.lastChainTime = now;
      return pool[this.chainIndex++ % pool.length];
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }

  get state(): AnimState {
    return this.currentState;
  }

  setOnStateChange(cb: (from: AnimState, to: AnimState) => void) {
    this.onStateChange = cb;
  }

  // Force a directional hit reaction (front/back/side picks the clip pool).
  transitionHit(newState: AnimState, dir: HitDirection) {
    this.transition(newState, true, dir);
  }

  transition(newState: AnimState, force = false, dir?: HitDirection) {
    if (!this.mixer) return;

    if (this.paused) {
      this.pendingTransition = { state: newState, force, dir };
      return;
    }

    if (newState === this.currentState && !force) return;

    const currentConfig = this.animMap[this.currentState];
    if (currentConfig && !currentConfig.canInterrupt && !force) {
      if (this.activeAction && this.activeAction.isRunning()) return;
    }

    const config = this.animMap[newState];
    if (!config) return;

    let clip = this.clips.get(this.resolveClipName(config, dir));
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

  // Scale the walk/run cycle to the fighter's real ground speed so the feet
  // track the floor instead of skating. (Root motion is stripped, so the cycle
  // otherwise plays at a fixed rate regardless of how fast the body moves.)
  matchLocomotionSpeed(worldSpeed: number) {
    if (!this.activeAction || this.paused) return;
    const s = this.currentState;
    if (s !== AnimState.Walk && s !== AnimState.Run) return;
    const cfg = this.animMap[s];
    if (!cfg) return;
    // Reference set a touch below the move speeds so the cycle plays slightly
    // fast and the feet keep up with the ground rather than sliding behind.
    const ref = s === AnimState.Run ? 4.2 : 1.6;
    const scale = Math.min(1.8, Math.max(0.7, worldSpeed / ref));
    this.activeAction.timeScale = cfg.speed * scale;
  }

  pause() {
    this.paused = true;
    if (this.mixer) this.mixer.timeScale = 0;
  }

  resume() {
    this.paused = false;
    if (this.mixer) this.mixer.timeScale = 1;
    if (this.pendingTransition) {
      const { state, dir } = this.pendingTransition;
      this.pendingTransition = null;
      // Clean slate after freeze — stop everything so transition()
      // plays the new clip at full weight with no stale crossfades
      this.mixer?.stopAllAction();
      this.activeAction = null;
      this.previousAction = null;
      this.transition(state, true, dir);
    }
  }

  setTimeScale(scale: number) {
    if (this.mixer) this.mixer.timeScale = scale;
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
