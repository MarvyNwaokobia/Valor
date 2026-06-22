export { HitboxSystem, CLASS_FRAME_DATA, getHitboxWindow, hitboxHits, hitboxContactPoint, DEFAULT_HURTBOX } from './HitboxSystem';
export type { HitboxData, HurtboxData, FrameData, HitResult } from './HitboxSystem';

export { MoveType, CLASS_MOVES, getMoveForAction } from './MoveRegistry';
export type { MoveDefinition } from './MoveRegistry';

export { DamageSystem, getBaseStats } from './DamageSystem';
export type { DamageEvent, DamageListener, FighterStats } from './DamageSystem';

export { AbilityManager, CLASS_ABILITIES } from './ClassAbilities';
export type { AbilityState, ClassAbility } from './ClassAbilities';

export { EnemyAI, AIState, AIDifficulty } from './EnemyAI';

export { ComboSystem, CLASS_COMBO_ROUTES } from './ComboSystem';
export type { ComboState, ComboRoute } from './ComboSystem';
