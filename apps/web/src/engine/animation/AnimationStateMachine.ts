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

const BERSERKER_ANIMS: AnimationMap = {
  [AnimState.Idle]: { clip: '0Idle', loop: true, speed: 1, fadeIn: 0.2, fadeOut: 0.2, canInterrupt: true },
  [AnimState.Walk]: { clip: 'walk', loop: true, speed: 1, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.Run]: { clip: 'running', loop: true, speed: 1, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.LightAttack]: { clip: 'punch', loop: false, speed: 1.3, fadeIn: 0.08, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: 'hardhitpunch', loop: false, speed: 1, fadeIn: 0.08, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]: { clip: 'fireslam', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]: { clip: 'fight.idle', loop: true, speed: 1, fadeIn: 0.1, fadeOut: 0.1, canInterrupt: true },
  [AnimState.BlockHit]: { clip: 'bump', loop: false, speed: 1.5, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Block },
  [AnimState.Dodge]: { clip: 'running', loop: false, speed: 2, fadeIn: 0.05, fadeOut: 0.15, duration: 0.3, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]: { clip: 'hitcenter', loop: false, speed: 1.4, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]: { clip: 'bump', loop: false, speed: 1, fadeIn: 0.05, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Knockdown]: { clip: 'onground', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.GetUp },
  [AnimState.GetUp]: { clip: 'groundtostand', loop: false, speed: 1, fadeIn: 0.15, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Death]: { clip: 'death', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0, canInterrupt: false },
  [AnimState.Victory]: { clip: 'willbow', loop: false, speed: 1, fadeIn: 0.2, fadeOut: 0, canInterrupt: false },
  [AnimState.Intro]: { clip: 'willfight', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
};

const SENTINEL_ANIMS: AnimationMap = {
  [AnimState.Idle]: { clip: 'root|Stand_Idle', loop: true, speed: 1, fadeIn: 0.2, fadeOut: 0.2, canInterrupt: true },
  [AnimState.Walk]: { clip: 'root|Stand_Walk', loop: true, speed: 1, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.Run]: { clip: 'root|Stand_Run', loop: true, speed: 1, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.LightAttack]: { clip: 'root|Float_Attack_1.1', loop: false, speed: 1.2, fadeIn: 0.08, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: 'root|Float_Attack_2.1', loop: false, speed: 1, fadeIn: 0.08, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]: { clip: 'root|Float_Spell', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]: { clip: 'root|Float_Blocking_Idle', loop: true, speed: 1, fadeIn: 0.1, fadeOut: 0.1, canInterrupt: true },
  [AnimState.BlockHit]: { clip: 'root|Float_Block_1', loop: false, speed: 1.5, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Block },
  [AnimState.Dodge]: { clip: 'root|Stand_Dash_Back', loop: false, speed: 1.5, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]: { clip: 'root|Float_Damage_1', loop: false, speed: 1.4, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]: { clip: 'root|Float_Damage_2', loop: false, speed: 1, fadeIn: 0.05, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Knockdown]: { clip: 'root|Float_Death_1', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.GetUp },
  [AnimState.GetUp]: { clip: 'root|Float_Death_1.2', loop: false, speed: 1, fadeIn: 0.15, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Death]: { clip: 'root|Stand_Death', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0, canInterrupt: false },
  [AnimState.Victory]: { clip: 'root|Stand_Power_Up', loop: false, speed: 1, fadeIn: 0.2, fadeOut: 0, canInterrupt: false },
  [AnimState.Intro]: { clip: 'root|Stand_Run_Starting', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
};

const PHANTOM_ANIMS: AnimationMap = {
  [AnimState.Idle]: { clip: 'Battle_Idle', loop: true, speed: 1, fadeIn: 0.2, fadeOut: 0.2, canInterrupt: true },
  [AnimState.Walk]: { clip: 'Walk', loop: true, speed: 1, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.Run]: { clip: 'Run', loop: true, speed: 1, fadeIn: 0.15, fadeOut: 0.15, canInterrupt: true },
  [AnimState.LightAttack]: { clip: 'Combo_01', loop: false, speed: 1.3, fadeIn: 0.08, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HeavyAttack]: { clip: 'Combo_03', loop: false, speed: 1, fadeIn: 0.08, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Special]: { clip: 'Skill_01', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Block]: { clip: 'Guard', loop: true, speed: 1, fadeIn: 0.1, fadeOut: 0.1, canInterrupt: true },
  [AnimState.BlockHit]: { clip: 'Guard_Damage', loop: false, speed: 1.5, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Block },
  [AnimState.Dodge]: { clip: 'Roll', loop: false, speed: 1.5, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitLight]: { clip: 'Damage_A', loop: false, speed: 1.4, fadeIn: 0.05, fadeOut: 0.15, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.HitHeavy]: { clip: 'Damage_C', loop: false, speed: 1, fadeIn: 0.05, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Knockdown]: { clip: 'Knockdown', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.GetUp },
  [AnimState.GetUp]: { clip: 'KD_Recovery', loop: false, speed: 1, fadeIn: 0.15, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
  [AnimState.Death]: { clip: 'Dead_A', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0, canInterrupt: false },
  [AnimState.Victory]: { clip: 'Stage_Win', loop: false, speed: 1, fadeIn: 0.2, fadeOut: 0, canInterrupt: false },
  [AnimState.Intro]: { clip: 'Tag_In', loop: false, speed: 1, fadeIn: 0.1, fadeOut: 0.2, canInterrupt: false, nextState: AnimState.Idle },
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

  constructor(animMap: AnimationMap) {
    this.animMap = animMap;
  }

  init(mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]) {
    this.mixer = mixer;
    this.clips.clear();
    for (const clip of clips) {
      this.clips.set(clip.name, clip);
    }
    this.transition(AnimState.Idle);
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

    const clip = this.clips.get(config.clip);
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
