export const CHARACTER_CLASSES = ['Berserker', 'Sentinel', 'Phantom', 'Warden', 'Specter', 'Vanguard'] as const
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

/** Character portrait image paths keyed by class + gender */
export const CHARACTER_IMAGES: Record<CharacterClass, { male: string; female: string }> = {
  Berserker: {
    male:   '/characters/classes/berserker-male.jpg',
    female: '/characters/classes/berserker-female.jpg',
  },
  Sentinel: {
    male:   '/characters/classes/sentinel-male.jpg',
    female: '/characters/classes/sentinel-female.jpg',
  },
  Phantom: {
    male:   '/characters/classes/phantom-male.jpg',
    female: '/characters/classes/phantom-female.jpg',
  },
  Warden: {
    male:   '/characters/classes/warden-male.jpg',
    female: '/characters/classes/warden-female.jpg',
  },
  Specter: {
    male:   '/characters/classes/specter-male.jpg',
    female: '/characters/classes/specter-female.jpg',
  },
  Vanguard: {
    male:   '/characters/classes/vanguard-male.jpg',
    female: '/characters/classes/vanguard-female.jpg',
  },
}

export const CLASS_DEFINITIONS: Record<CharacterClass, ClassDefinition> = {
  Berserker: {
    id: 'Berserker',
    name: 'Berserker',
    tagline: 'Pure power. No mercy.',
    description:
      'A rage-fueled warrior who trades armor for overwhelming offense. Berserkers hit the hardest and fall the hardest — every fight is all or nothing.',
    accentColor: '#ef4444',
    accentColorDim: 'rgba(239,68,68,0.12)',
    glowColor: 'rgba(239,68,68,0.5)',
    stats: { attack: 16, defense: 7, speed: 9 },
    weapon: 'Dual Battle Axes',
    special: 'Berserker Rage',
    specialDesc: 'Deals 3× base damage. No holding back.',
    playStyle: 'Aggressive — win fast or fall hard.',
  },

  Sentinel: {
    id: 'Sentinel',
    name: 'Sentinel',
    tagline: 'Stand your ground.',
    description:
      'An unbreakable wall who counters with every hit absorbed. Sentinels outlast any opponent — patience is their deadliest weapon.',
    accentColor: '#3b82f6',
    accentColorDim: 'rgba(59,130,246,0.12)',
    glowColor: 'rgba(59,130,246,0.5)',
    stats: { attack: 9, defense: 16, speed: 7 },
    weapon: 'Sword & Tower Shield',
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
    weapon: 'Twin Void Blades',
    special: 'Shadow Strike',
    specialDesc: 'Always strikes first. Bypasses enemy defense.',
    playStyle: 'Evasive — speed is your armor.',
  },

  Warden: {
    id: 'Warden',
    name: 'Warden',
    tagline: 'Ancient. Immovable. Eternal.',
    description:
      'Bound to the earth itself. Wardens channel nature\'s raw force into devastating blows that shatter armor. The older the fight, the stronger they get.',
    accentColor: '#22c55e',
    accentColorDim: 'rgba(34,197,94,0.12)',
    glowColor: 'rgba(34,197,94,0.5)',
    stats: { attack: 11, defense: 18, speed: 5 },
    weapon: 'Stone War Hammer',
    special: 'Earth Crush',
    specialDesc: 'Ignores 40% of enemy defense. The ground itself answers.',
    playStyle: 'Endurance — absorb everything, crush the rest.',
  },

  Specter: {
    id: 'Specter',
    name: 'Specter',
    tagline: 'You cannot fight what you cannot see.',
    description:
      'Masters of arcane energy and misdirection. Specters bend the rules of combat — attacking from impossible angles, nullifying abilities, and vanishing between strikes.',
    accentColor: '#e2e8f0',
    accentColorDim: 'rgba(226,232,240,0.08)',
    glowColor: 'rgba(226,232,240,0.45)',
    stats: { attack: 13, defense: 9, speed: 12 },
    weapon: 'Arcane Pistols',
    special: 'Void Shift',
    specialDesc: 'Teleports behind the enemy. Next attack is guaranteed critical.',
    playStyle: 'Tactical — control the fight, never be where expected.',
  },

  Vanguard: {
    id: 'Vanguard',
    name: 'Vanguard',
    tagline: 'First in. Last standing.',
    description:
      'Built like a weapon, fights like a war. Vanguards crash into every battle with overwhelming force — their molten armor converts incoming damage into fuel for the next strike.',
    accentColor: '#f97316',
    accentColorDim: 'rgba(249,115,22,0.12)',
    glowColor: 'rgba(249,115,22,0.5)',
    stats: { attack: 18, defense: 12, speed: 5 },
    weapon: 'Assault Cannon',
    special: 'Molten Charge',
    specialDesc: 'Converts 30% of damage taken into bonus attack on next hit.',
    playStyle: 'Relentless — the more you take, the harder you hit.',
  },
}

/** Returns stat variance seeded by wallet address (±3 on each stat) */
export function statVarianceFromWallet(wallet: string): number {
  const seed = wallet.slice(-6).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return (seed % 7) - 3
}
