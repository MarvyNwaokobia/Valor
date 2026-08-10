export const CHARACTER_CLASSES = ['Berserker', 'Sentinel', 'Phantom'] as const
export type CharacterClass = (typeof CHARACTER_CLASSES)[number]

export interface ClassDefinition {
  id: CharacterClass
  name: string
  tagline: string
  description: string
  accentColor: string
  accentColorDim: string
  glowColor: string
  stats: {
    attack: number
    defense: number
    speed: number
  }
  weapon: string
  special: string
  specialDesc: string
  playStyle: string
}

/** GLB paths for 3D character models (output of scripts/fbx_to_glb.py) */
// Each class maps to the GLB of the SAME name. It used to map Sentinel to
// phantom.glb and Phantom to sentinel.glb - a swap that compensated for the old
// fantasy models being mismatched to their classes. The models are now tactical
// operators picked to fit each class's role, so the indirection is gone:
//   berserker.glb  Mixamo "Soldier"      - assault, plate carrier, helmet
//   sentinel.glb   Mixamo "Ch35"         - heavy riot armour and gas mask
//   phantom.glb    Mixamo "SpacePirate"  - lean and fast
export const CHARACTER_GLB: Record<CharacterClass, string> = {
  Berserker: '/characters/glb/berserker.glb',
  Sentinel:  '/characters/glb/sentinel.glb',
  Phantom:   '/characters/glb/phantom.glb',
}

/** Portrait images, rendered from the GLBs by scripts/bake_class_portraits.py.
 *  One render per class: the male/female split is kept only because
 *  CharacterPortrait and TutorialArena index into it, and there is no
 *  gender-swapped variant of these operators. */
export const CHARACTER_IMAGES: Record<CharacterClass, { male: string; female: string }> = {
  Berserker: {
    male:   '/characters/classes/berserker.webp',
    female: '/characters/classes/berserker.webp',
  },
  Sentinel: {
    male:   '/characters/classes/sentinel.webp',
    female: '/characters/classes/sentinel.webp',
  },
  Phantom: {
    male:   '/characters/classes/phantom.webp',
    female: '/characters/classes/phantom.webp',
  },
}

export const CLASS_DEFINITIONS: Record<CharacterClass, ClassDefinition> = {
  Berserker: {
    id: 'Berserker',
    name: 'Berserker',
    tagline: 'Pure power. No mercy.',
    description:
      'An assault operator who trades armour for overwhelming firepower. Berserkers hit the hardest and fall the hardest — every fight is all or nothing.',
    accentColor: '#ef4444',
    accentColorDim: 'rgba(239,68,68,0.12)',
    glowColor: 'rgba(239,68,68,0.5)',
    stats: { attack: 16, defense: 7, speed: 9 },
    weapon: 'Ashfall Carbine',
    special: 'Berserker Rage',
    specialDesc: 'Deals 3× base damage. No holding back.',
    playStyle: 'Aggressive — win fast or fall hard.',
  },

  Sentinel: {
    id: 'Sentinel',
    name: 'Sentinel',
    tagline: 'Stand your ground.',
    description:
      'A breacher in heavy plate who counters with every round absorbed. Sentinels outlast any opponent — patience is their deadliest weapon.',
    accentColor: '#3b82f6',
    accentColorDim: 'rgba(59,130,246,0.12)',
    glowColor: 'rgba(59,130,246,0.5)',
    stats: { attack: 9, defense: 16, speed: 7 },
    weapon: 'Seraph LMG',
    special: 'Iron Fortress',
    specialDesc: 'Absorbs the next attack and reflects 50% back.',
    playStyle: 'Defensive — outlast and punish.',
  },

  Phantom: {
    id: 'Phantom',
    name: 'Phantom',
    tagline: 'Strike fast. Vanish. Repeat.',
    description:
      "Speed is their armor. Phantoms attack before the enemy reacts — by the time you see them, they're already gone.",
    accentColor: '#8b5cf6',
    accentColorDim: 'rgba(139,92,246,0.12)',
    glowColor: 'rgba(139,92,246,0.5)',
    stats: { attack: 12, defense: 7, speed: 15 },
    weapon: 'Rift Lance',
    special: 'Shadow Strike',
    specialDesc: 'Always strikes first. Bypasses enemy defense.',
    playStyle: 'Evasive — speed is your armor.',
  },
}

/** Returns stat variance seeded by wallet address (±3 on each stat) */
export function statVarianceFromWallet(wallet: string): number {
  const seed = wallet.slice(-6).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return (seed % 7) - 3
}
