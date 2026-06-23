export enum Action {
  MoveForward = 'MoveForward',
  MoveBack = 'MoveBack',
  MoveLeft = 'MoveLeft',
  MoveRight = 'MoveRight',
  LightAttack = 'LightAttack',
  HeavyAttack = 'HeavyAttack',
  Special = 'Special',
  Block = 'Block',
  Dodge = 'Dodge',
  Jump = 'Jump',
  LockOn = 'LockOn',
}

interface ActionState {
  held: boolean;
  justPressed: boolean;
  justReleased: boolean;
}

const DEFAULT_BINDINGS: Record<string, Action> = {
  KeyW: Action.MoveForward,
  ArrowUp: Action.MoveForward,
  KeyS: Action.MoveBack,
  ArrowDown: Action.MoveBack,
  KeyA: Action.MoveLeft,
  ArrowLeft: Action.MoveLeft,
  KeyD: Action.MoveRight,
  ArrowRight: Action.MoveRight,
  KeyJ: Action.LightAttack,
  KeyK: Action.HeavyAttack,
  KeyL: Action.Special,
  ShiftLeft: Action.Block,
  ShiftRight: Action.Block,
  Space: Action.Dodge,
  Tab: Action.LockOn,
};

const BUFFERED_ACTIONS = [
  Action.LightAttack, Action.HeavyAttack, Action.Special, Action.Dodge, Action.Jump,
];

// Double-tap forward (within this window) is a jump on keyboard.
const DOUBLE_TAP_MS = 280;

export class InputSystem {
  private keys = new Set<string>();
  private prevKeys = new Set<string>();
  private bindings: Record<string, Action>;
  private stickX = 0;
  private stickY = 0;
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private pointerLocked = false;

  private buffer = new Map<Action, number>();
  private readonly bufferMs = 130;
  private lastForwardTap = 0;

  constructor(bindings?: Record<string, Action>) {
    this.bindings = bindings ?? { ...DEFAULT_BINDINGS };
  }

  attach(el: HTMLElement | Window = window) {
    const target = el as EventTarget;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    return () => this.detach(el);
  }

  detach(el: HTMLElement | Window = window) {
    const target = el as EventTarget;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  update() {
    this.prevKeys = new Set(this.keys);
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  getAction(action: Action): ActionState {
    const held = this.isActionHeld(action);
    const wasHeld = this.wasActionHeld(action);
    return {
      held,
      justPressed: held && !wasHeld,
      justReleased: !held && wasHeld,
    };
  }

  consumeBuffered(action: Action): boolean {
    const t = this.buffer.get(action);
    if (t !== undefined && performance.now() - t <= this.bufferMs) {
      this.buffer.delete(action);
      return true;
    }
    return false;
  }

  get moveAxis(): { x: number; y: number } {
    let x = this.stickX;
    let y = this.stickY;

    if (this.keys.has(Action.MoveRight)) x += 1;
    if (this.keys.has(Action.MoveLeft)) x -= 1;
    if (this.keys.has(Action.MoveForward)) y += 1;
    if (this.keys.has(Action.MoveBack)) y -= 1;

    const len = Math.sqrt(x * x + y * y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  get lookDelta(): { x: number; y: number } {
    return { x: this.mouseDeltaX, y: this.mouseDeltaY };
  }

  setStick(x: number, y: number) {
    this.stickX = x;
    this.stickY = y;
  }

  triggerAction(action: Action) {
    this.keys.add(action);
    if (BUFFERED_ACTIONS.includes(action)) {
      this.buffer.set(action, performance.now());
    }
  }

  releaseAction(action: Action) {
    this.keys.delete(action);
  }

  private isActionHeld(action: Action): boolean {
    return this.keys.has(action);
  }

  private wasActionHeld(action: Action): boolean {
    return this.prevKeys.has(action);
  }

  private onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.repeat) return;
    const action = this.bindings[ke.code];
    if (action) {
      ke.preventDefault();
      this.keys.add(action);
      if (BUFFERED_ACTIONS.includes(action)) {
        this.buffer.set(action, performance.now());
      }
      // Double-tap forward = jump.
      if (action === Action.MoveForward) {
        const now = performance.now();
        if (now - this.lastForwardTap < DOUBLE_TAP_MS) {
          this.buffer.set(Action.Jump, now);
        }
        this.lastForwardTap = now;
      }
    }
  };

  private onKeyUp = (e: Event) => {
    const ke = e as KeyboardEvent;
    const action = this.bindings[ke.code];
    if (action) {
      ke.preventDefault();
      this.keys.delete(action);
    }
  };

  private onMouseMove = (e: Event) => {
    const me = e as MouseEvent;
    if (this.pointerLocked) {
      this.mouseDeltaX += me.movementX;
      this.mouseDeltaY += me.movementY;
    }
  };

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement !== null;
  };
}

let instance: InputSystem | null = null;

export function getInputSystem(): InputSystem {
  if (!instance) instance = new InputSystem();
  return instance;
}
