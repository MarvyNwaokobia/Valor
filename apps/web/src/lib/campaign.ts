import type { CharacterClass } from '@/lib/classes'
import type { BotPersonality } from '@/lib/combat/types'

export interface BossDefinition {
  id: string
  name: string
  title: string
  characterClass: CharacterClass
  personality: BotPersonality
  accentColor: string
  /** Stat multiplier on top of rank-based stats (1.0 = normal) */
  damageMult: number
  /** HP multiplier (1.0 = 100 HP) */
  hpMult: number
  /** Reaction speed multiplier (lower = faster, applied to rank range) */
  reactionMult: number
}

export interface DialogueLine {
  speaker: 'boss' | 'narrator'
  text: string
}

export interface Chapter {
  id: string
  number: number
  title: string
  subtitle: string
  description: string
  boss: BossDefinition
  /** Dialogue shown before the fight */
  preFightDialogue: DialogueLine[]
  /** Line shown on victory */
  victoryLine: string
  /** Line shown on defeat */
  defeatLine: string
  /** XP bonus for first clear */
  firstClearBonus: number
  /** Unlock requirement: previous chapter id (null = always available) */
  requiresChapter: string | null
}

// ── Boss Definitions ─────────────────────────────────────────────────────────

const BOSS_KAEL: BossDefinition = {
  id: 'kael',
  name: 'Kael',
  title: 'The Branded',
  characterClass: 'Berserker',
  personality: 'balanced',
  accentColor: '#b45309',
  damageMult: 0.8,
  hpMult: 0.9,
  reactionMult: 1.3,
}

const BOSS_VEYRA: BossDefinition = {
  id: 'veyra',
  name: 'Veyra',
  title: 'Iron Vow',
  characterClass: 'Sentinel',
  personality: 'defensive',
  accentColor: '#0ea5e9',
  damageMult: 0.9,
  hpMult: 1.3,
  reactionMult: 1.1,
}

const BOSS_SHADE: BossDefinition = {
  id: 'shade',
  name: 'Shade',
  title: 'The Unseen',
  characterClass: 'Phantom',
  personality: 'adaptive',
  accentColor: '#a855f7',
  damageMult: 1.1,
  hpMult: 0.85,
  reactionMult: 0.8,
}

const BOSS_ORYN: BossDefinition = {
  id: 'oryn',
  name: 'Oryn',
  title: 'The Scarred King',
  characterClass: 'Berserker',
  personality: 'aggressive',
  accentColor: '#dc2626',
  damageMult: 1.3,
  hpMult: 1.2,
  reactionMult: 0.7,
}

const BOSS_MIRROR: BossDefinition = {
  id: 'mirror',
  name: '???',
  title: 'Your Shadow',
  characterClass: 'Berserker', // overridden to match player
  personality: 'adaptive',
  accentColor: '#334155',
  damageMult: 1.2,
  hpMult: 1.1,
  reactionMult: 0.6,
}

// ── Chapters ─────────────────────────────────────────────────────────────────

export const CAMPAIGN_CHAPTERS: Chapter[] = [
  {
    id: 'ch1',
    number: 1,
    title: 'The Proving Ground',
    subtitle: 'Every legend begins with a single blow.',
    description: 'An outcast warrior blocks your path to the Arena. Prove you belong.',
    boss: BOSS_KAEL,
    preFightDialogue: [
      { speaker: 'narrator', text: 'The gates of the Valor Arena loom ahead — ancient stone carved with the names of fallen warriors.' },
      { speaker: 'narrator', text: 'A scarred figure steps from the shadows, blade already drawn.' },
      { speaker: 'boss', text: "Another one who thinks they're ready. They all look the same before the first hit lands." },
      { speaker: 'boss', text: "I was like you once. Eager. Untested. Show me what you've got — or turn back now." },
    ],
    victoryLine: "Not bad. Maybe you'll last longer than the others.",
    defeatLine: 'Come back when you can take a punch, rookie.',
    firstClearBonus: 50,
    requiresChapter: null,
  },
  {
    id: 'ch2',
    number: 2,
    title: 'The Iron Vow',
    subtitle: 'Some walls were never meant to fall.',
    description: 'Veyra, the Arena\'s unbroken champion, fights with a shield no blade has pierced.',
    boss: BOSS_VEYRA,
    preFightDialogue: [
      { speaker: 'narrator', text: 'The second gate opens to a stillness that feels heavier than silence.' },
      { speaker: 'narrator', text: 'A sentinel stands at the center — motionless, waiting, her shield reflecting your approach.' },
      { speaker: 'boss', text: 'I made a vow to guard this gate. Forty-three challengers have fallen trying to pass.' },
      { speaker: 'boss', text: "You will not break my guard. But you're welcome to try." },
    ],
    victoryLine: 'My vow... remains. But you have earned your passage.',
    defeatLine: 'Forty-four.',
    firstClearBonus: 75,
    requiresChapter: 'ch1',
  },
  {
    id: 'ch3',
    number: 3,
    title: 'The Unseen',
    subtitle: 'You cannot fight what you cannot find.',
    description: 'Shade strikes from angles that shouldn\'t exist. Speed alone won\'t save you.',
    boss: BOSS_SHADE,
    preFightDialogue: [
      { speaker: 'narrator', text: 'The arena dims. The torches flicker and die, one by one.' },
      { speaker: 'narrator', text: 'A voice comes from everywhere and nowhere.' },
      { speaker: 'boss', text: "Most fighters rely on what they can see. That's their first mistake." },
      { speaker: 'boss', text: 'By the time you find me, the fight will already be over.' },
    ],
    victoryLine: "You... saw through me. No one's done that before.",
    defeatLine: 'Blink, and you missed it.',
    firstClearBonus: 100,
    requiresChapter: 'ch2',
  },
  {
    id: 'ch4',
    number: 4,
    title: 'The Scarred King',
    subtitle: 'Every scar tells the story of someone who wasn\'t strong enough.',
    description: 'Oryn ruled the Arena before the world forgot his name. His rage never dimmed.',
    boss: BOSS_ORYN,
    preFightDialogue: [
      { speaker: 'narrator', text: 'The final gate is not stone but scorched metal, warped by heat and violence.' },
      { speaker: 'narrator', text: 'The man who waits beyond it is more scar than skin. He does not speak — he roars.' },
      { speaker: 'boss', text: 'THEY TOOK EVERYTHING. My name. My crown. My kingdom.' },
      { speaker: 'boss', text: "But they couldn't take this — " },
      { speaker: 'boss', text: 'THE RAGE THAT KEEPS ME STANDING.' },
    ],
    victoryLine: '...Finally. Someone strong enough to end it.',
    defeatLine: 'A king does not fall to pretenders.',
    firstClearBonus: 150,
    requiresChapter: 'ch3',
  },
  {
    id: 'ch5',
    number: 5,
    title: 'The Mirror',
    subtitle: 'The only enemy you can never outrun.',
    description: 'The Arena\'s final trial. Face yourself — or fall to your own shadow.',
    boss: BOSS_MIRROR,
    preFightDialogue: [
      { speaker: 'narrator', text: 'The arena is empty. The crowd is gone. Only silence remains.' },
      { speaker: 'narrator', text: 'And then — from the far side — a figure steps forward.' },
      { speaker: 'narrator', text: 'It moves like you. Stands like you. Fights like you.' },
      { speaker: 'boss', text: '...' },
      { speaker: 'narrator', text: 'Your shadow draws its weapon.' },
    ],
    victoryLine: 'You have conquered yourself. The Arena has a new champion.',
    defeatLine: 'You were not ready to face the truth.',
    firstClearBonus: 250,
    requiresChapter: 'ch4',
  },
]

export function getChapter(id: string): Chapter | undefined {
  return CAMPAIGN_CHAPTERS.find(c => c.id === id)
}

export function isChapterUnlocked(chapterId: string, completedChapters: string[]): boolean {
  const chapter = getChapter(chapterId)
  if (!chapter) return false
  if (!chapter.requiresChapter) return true
  return completedChapters.includes(chapter.requiresChapter)
}
