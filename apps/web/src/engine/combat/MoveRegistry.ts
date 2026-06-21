import { AnimState } from '../animation';

export enum MoveType {
  LightAttack = 'lightAttack',
  HeavyAttack = 'heavyAttack',
  Special = 'special',
  Block = 'block',
  Dodge = 'dodge',
}

export interface MoveDefinition {
  type: MoveType;
  animState: AnimState;
  damage: number;
  staminaCost: number;
  cooldown: number;
  canChainFrom: MoveType[];
  chainWindow: number;
  lunge: number;
  superArmorFrames: number;
  blockable: boolean;
  countersBlock: boolean;
}

const BERSERKER_MOVES: Record<MoveType, MoveDefinition> = {
  [MoveType.LightAttack]: {
    type: MoveType.LightAttack,
    animState: AnimState.LightAttack,
    damage: 8,
    staminaCost: 5,
    cooldown: 0,
    canChainFrom: [MoveType.LightAttack, MoveType.Dodge],
    chainWindow: 0.3,
    lunge: 1.5,
    superArmorFrames: 0,
    blockable: true,
    countersBlock: false,
  },
  [MoveType.HeavyAttack]: {
    type: MoveType.HeavyAttack,
    animState: AnimState.HeavyAttack,
    damage: 18,
    staminaCost: 15,
    cooldown: 0.5,
    canChainFrom: [MoveType.LightAttack],
    chainWindow: 0.4,
    lunge: 2.5,
    superArmorFrames: 6,
    blockable: true,
    countersBlock: false,
  },
  [MoveType.Special]: {
    type: MoveType.Special,
    animState: AnimState.Special,
    damage: 25,
    staminaCost: 30,
    cooldown: 3,
    canChainFrom: [MoveType.HeavyAttack],
    chainWindow: 0.5,
    lunge: 3,
    superArmorFrames: 10,
    blockable: false,
    countersBlock: true,
  },
  [MoveType.Block]: {
    type: MoveType.Block,
    animState: AnimState.Block,
    damage: 0,
    staminaCost: 2,
    cooldown: 0,
    canChainFrom: [],
    chainWindow: 0,
    lunge: 0,
    superArmorFrames: 0,
    blockable: false,
    countersBlock: false,
  },
  [MoveType.Dodge]: {
    type: MoveType.Dodge,
    animState: AnimState.Dodge,
    damage: 0,
    staminaCost: 12,
    cooldown: 0.8,
    canChainFrom: [],
    chainWindow: 0,
    lunge: 0,
    superArmorFrames: 0,
    blockable: false,
    countersBlock: false,
  },
};

const SENTINEL_MOVES: Record<MoveType, MoveDefinition> = {
  [MoveType.LightAttack]: {
    type: MoveType.LightAttack,
    animState: AnimState.LightAttack,
    damage: 7,
    staminaCost: 4,
    cooldown: 0,
    canChainFrom: [MoveType.LightAttack, MoveType.Dodge],
    chainWindow: 0.35,
    lunge: 1.2,
    superArmorFrames: 0,
    blockable: true,
    countersBlock: false,
  },
  [MoveType.HeavyAttack]: {
    type: MoveType.HeavyAttack,
    animState: AnimState.HeavyAttack,
    damage: 16,
    staminaCost: 12,
    cooldown: 0.6,
    canChainFrom: [MoveType.LightAttack],
    chainWindow: 0.4,
    lunge: 2,
    superArmorFrames: 8,
    blockable: true,
    countersBlock: false,
  },
  [MoveType.Special]: {
    type: MoveType.Special,
    animState: AnimState.Special,
    damage: 22,
    staminaCost: 25,
    cooldown: 4,
    canChainFrom: [MoveType.HeavyAttack, MoveType.Block],
    chainWindow: 0.6,
    lunge: 1,
    superArmorFrames: 14,
    blockable: false,
    countersBlock: true,
  },
  [MoveType.Block]: {
    type: MoveType.Block,
    animState: AnimState.Block,
    damage: 0,
    staminaCost: 1,
    cooldown: 0,
    canChainFrom: [],
    chainWindow: 0,
    lunge: 0,
    superArmorFrames: 0,
    blockable: false,
    countersBlock: false,
  },
  [MoveType.Dodge]: {
    type: MoveType.Dodge,
    animState: AnimState.Dodge,
    damage: 0,
    staminaCost: 10,
    cooldown: 1,
    canChainFrom: [],
    chainWindow: 0,
    lunge: 0,
    superArmorFrames: 0,
    blockable: false,
    countersBlock: false,
  },
};

const PHANTOM_MOVES: Record<MoveType, MoveDefinition> = {
  [MoveType.LightAttack]: {
    type: MoveType.LightAttack,
    animState: AnimState.LightAttack,
    damage: 6,
    staminaCost: 3,
    cooldown: 0,
    canChainFrom: [MoveType.LightAttack, MoveType.Dodge],
    chainWindow: 0.25,
    lunge: 1.8,
    superArmorFrames: 0,
    blockable: true,
    countersBlock: false,
  },
  [MoveType.HeavyAttack]: {
    type: MoveType.HeavyAttack,
    animState: AnimState.HeavyAttack,
    damage: 14,
    staminaCost: 10,
    cooldown: 0.3,
    canChainFrom: [MoveType.LightAttack, MoveType.LightAttack],
    chainWindow: 0.3,
    lunge: 2.2,
    superArmorFrames: 0,
    blockable: true,
    countersBlock: false,
  },
  [MoveType.Special]: {
    type: MoveType.Special,
    animState: AnimState.Special,
    damage: 20,
    staminaCost: 20,
    cooldown: 2.5,
    canChainFrom: [MoveType.HeavyAttack, MoveType.Dodge],
    chainWindow: 0.4,
    lunge: 4,
    superArmorFrames: 0,
    blockable: false,
    countersBlock: true,
  },
  [MoveType.Block]: {
    type: MoveType.Block,
    animState: AnimState.Block,
    damage: 0,
    staminaCost: 3,
    cooldown: 0,
    canChainFrom: [],
    chainWindow: 0,
    lunge: 0,
    superArmorFrames: 0,
    blockable: false,
    countersBlock: false,
  },
  [MoveType.Dodge]: {
    type: MoveType.Dodge,
    animState: AnimState.Dodge,
    damage: 0,
    staminaCost: 8,
    cooldown: 0.6,
    canChainFrom: [],
    chainWindow: 0,
    lunge: 0,
    superArmorFrames: 0,
    blockable: false,
    countersBlock: false,
  },
};

export const CLASS_MOVES: Record<string, Record<MoveType, MoveDefinition>> = {
  berserker: BERSERKER_MOVES,
  sentinel: SENTINEL_MOVES,
  phantom: PHANTOM_MOVES,
};

export function getMoveForAction(
  classId: string,
  moveType: MoveType
): MoveDefinition | undefined {
  return CLASS_MOVES[classId]?.[moveType];
}
