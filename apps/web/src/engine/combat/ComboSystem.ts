import { MoveType } from './MoveRegistry';

export interface ComboState {
  count: number;
  moves: MoveType[];
  timer: number;
  damageMultiplier: number;
  longestCombo: number;
}

export interface ComboRoute {
  sequence: MoveType[];
  name: string;
  bonusDamage: number;
  finisherKnockback: number;
}

const BERSERKER_ROUTES: ComboRoute[] = [
  {
    sequence: [MoveType.LightAttack, MoveType.LightAttack, MoveType.HeavyAttack],
    name: 'Crusher',
    bonusDamage: 1.5,
    finisherKnockback: 2,
  },
  {
    sequence: [MoveType.LightAttack, MoveType.HeavyAttack, MoveType.Special],
    name: 'Inferno Rush',
    bonusDamage: 1.8,
    finisherKnockback: 3,
  },
  {
    sequence: [MoveType.HeavyAttack, MoveType.HeavyAttack],
    name: 'Double Slam',
    bonusDamage: 1.4,
    finisherKnockback: 2.5,
  },
];

const SENTINEL_ROUTES: ComboRoute[] = [
  {
    sequence: [MoveType.LightAttack, MoveType.LightAttack, MoveType.LightAttack],
    name: 'Divine Strikes',
    bonusDamage: 1.3,
    finisherKnockback: 1.5,
  },
  {
    sequence: [MoveType.Block, MoveType.HeavyAttack, MoveType.Special],
    name: 'Shield Combo',
    bonusDamage: 2.0,
    finisherKnockback: 3,
  },
  {
    sequence: [MoveType.LightAttack, MoveType.HeavyAttack],
    name: 'Holy Smite',
    bonusDamage: 1.4,
    finisherKnockback: 2,
  },
];

const PHANTOM_ROUTES: ComboRoute[] = [
  {
    sequence: [MoveType.LightAttack, MoveType.LightAttack, MoveType.LightAttack, MoveType.HeavyAttack],
    name: 'Shadow Flurry',
    bonusDamage: 1.6,
    finisherKnockback: 2,
  },
  {
    sequence: [MoveType.Dodge, MoveType.LightAttack, MoveType.Special],
    name: 'Phantom Strike',
    bonusDamage: 2.2,
    finisherKnockback: 3,
  },
  {
    sequence: [MoveType.LightAttack, MoveType.LightAttack, MoveType.LightAttack],
    name: 'Triple Slash',
    bonusDamage: 1.3,
    finisherKnockback: 1,
  },
];

export const CLASS_COMBO_ROUTES: Record<string, ComboRoute[]> = {
  berserker: BERSERKER_ROUTES,
  sentinel: SENTINEL_ROUTES,
  phantom: PHANTOM_ROUTES,
};

const ATTACK_MOVES = new Set<MoveType>([
  MoveType.LightAttack, MoveType.HeavyAttack, MoveType.Special,
]);

// A class's combo routes expressed as pure attack strings — the ones you can
// build by cancelling one attack into the next. Routes that open with Block/Dodge
// (e.g. Shield Combo, Phantom Strike) are dropped here; they're scored by the
// landed-hit damage system, not the attack-cancel gatling.
export function getGatlingRoutes(classId: string): MoveType[][] {
  return (CLASS_COMBO_ROUTES[classId] ?? [])
    .map((r) => r.sequence)
    .filter((seq) => seq.length > 1 && seq.every((m) => ATTACK_MOVES.has(m)));
}

// Can `next` cancel-extend the current attack string for this class? True when
// [...current, next] is a prefix of one of the class's attack routes — so strings
// only flow along that class's real routes (Berserker L→H→S "Inferno Rush", etc.)
// instead of any-into-any. A fresh attack (empty `current`) is gated by the caller,
// not here.
export function canGatlingCancel(classId: string, current: MoveType[], next: MoveType): boolean {
  return getGatlingRoutes(classId).some((seq) => {
    if (current.length + 1 > seq.length) return false;
    for (let i = 0; i < current.length; i++) {
      if (seq[i] !== current[i]) return false;
    }
    return seq[current.length] === next;
  });
}

// The combo window, in seconds. Tracked purely on the game `dt` clock (see
// `update`), so it freezes during hitstop along with everything else and never
// drifts against the animation clock.
const COMBO_WINDOW = 0.8;
const BASE_SCALING = 0.05;
const MAX_COMBO_MULT = 2.5;

export class ComboSystem {
  private states: Map<string, ComboState> = new Map();
  private routes: Map<string, ComboRoute[]> = new Map();
  private onComboEvent?: (fighterId: string, combo: ComboState, route?: ComboRoute) => void;

  register(fighterId: string, classId: string) {
    this.states.set(fighterId, {
      count: 0,
      moves: [],
      timer: 0,
      damageMultiplier: 1,
      longestCombo: 0,
    });
    this.routes.set(fighterId, CLASS_COMBO_ROUTES[classId] ?? []);
  }

  setOnComboEvent(cb: (fighterId: string, combo: ComboState, route?: ComboRoute) => void) {
    this.onComboEvent = cb;
  }

  registerHit(fighterId: string, move: MoveType): {
    multiplier: number;
    matchedRoute?: ComboRoute;
    comboCount: number;
  } {
    const state = this.states.get(fighterId);
    if (!state) return { multiplier: 1, comboCount: 0 };

    // If the window has already lapsed (timer drained to 0 by `update`), this hit
    // starts a fresh combo. Otherwise it extends the current one.
    if (state.timer <= 0) {
      state.count = 0;
      state.moves = [];
      state.damageMultiplier = 1;
    }

    state.count++;
    state.moves.push(move);
    state.timer = COMBO_WINDOW;
    state.damageMultiplier = Math.min(
      MAX_COMBO_MULT,
      1 + state.count * BASE_SCALING
    );

    if (state.count > state.longestCombo) {
      state.longestCombo = state.count;
    }

    const matchedRoute = this.checkRoutes(fighterId, state.moves);

    if (matchedRoute) {
      state.damageMultiplier *= matchedRoute.bonusDamage;
    }

    this.onComboEvent?.(fighterId, { ...state }, matchedRoute);

    return {
      multiplier: state.damageMultiplier,
      matchedRoute,
      comboCount: state.count,
    };
  }

  update(dt: number) {
    for (const state of this.states.values()) {
      if (state.timer > 0) {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.count = 0;
          state.moves = [];
          state.damageMultiplier = 1;
        }
      }
    }
  }

  getState(fighterId: string): ComboState | undefined {
    return this.states.get(fighterId);
  }

  drop(fighterId: string) {
    const state = this.states.get(fighterId);
    if (state) {
      state.count = 0;
      state.moves = [];
      state.damageMultiplier = 1;
      state.timer = 0;
    }
  }

  private checkRoutes(fighterId: string, moves: MoveType[]): ComboRoute | undefined {
    const routes = this.routes.get(fighterId);
    if (!routes) return undefined;

    for (const route of routes) {
      const seq = route.sequence;
      if (moves.length < seq.length) continue;

      const tail = moves.slice(-seq.length);
      if (tail.every((m, i) => m === seq[i])) {
        return route;
      }
    }
    return undefined;
  }
}
