/**
 * The three voices (CLONE_PLAN.md slice 5: Valor as presence).
 *
 * The gate for this slice: a first-time player can say who they are, who
 * Ember is, and why Valor scares them, WITHOUT reading a menu. So the story
 * arrives as voices over the fight, never as a screen you must visit:
 *
 *   ASH   — the hero. The one who walked out of the fire. Never speaks;
 *           everyone speaks TO them (the GoW intimacy trick at zero VO cost).
 *   EMBER — the other survivor. Your ally on a scavenged radio. Warm, scared,
 *           practical. The relationship arc of the campaign.
 *   VALOR — the name every enemy dies protecting. He has your radio channel.
 *           He is never a body in zone 1 — only a voice that owns things:
 *           the crew, Cinder, and the blade in your hand.
 *
 * Delivery: each line is a radio-styled subtitle + per-speaker static
 * signature now; the ids map 1:1 to VO files (public/vo/{id}.mp3) that
 * scripts/generate-vo.mjs produces when an ElevenLabs key is available.
 * AudioDirector.playVo() prefers the file and falls back to static-only.
 *
 * Lines are data, triggers are semantic — the campaign reuses this exact
 * shape when the playground grows into Ashfall (slice 6).
 */

export type Speaker = 'ember' | 'valor' | 'cinder';

export interface PresenceLine {
  id: string;
  speaker: Speaker;
  text: string;
  trigger: PresenceTrigger;
}

export type PresenceTrigger =
  | 'combatStart'   // first fight of the session
  | 'firstCatch'    // the first recall catch — the weapon acknowledged
  | 'lowHp'         // first time below 30
  | 'troopsCleared' // round 1 down, something else is coming
  | 'bossIntro'     // Cinder takes the field
  | 'bossPhase2'
  | 'bossPhase3'
  | 'heroDown'
  | 'zoneClear'     // Cinder dead
  | 'zoneClearTag'; // the follow-up beat after zoneClear

export const SPEAKER_META: Record<Speaker, { name: string; color: string }> = {
  ember: { name: 'EMBER', color: '#ffb38a' },
  valor: { name: 'VALOR', color: '#e0455a' },
  cinder: { name: 'CINDER', color: '#ff4422' },
};

export const PRESENCE_LINES: PresenceLine[] = [
  {
    id: 'ember-radio-check',
    speaker: 'ember',
    trigger: 'combatStart',
    text: "Radio check. Ash, it's me. So you actually took the blade... they're going to come for it.",
  },
  {
    id: 'ember-first-catch',
    speaker: 'ember',
    trigger: 'firstCatch',
    text: 'It comes back to you. It never did that for any of them.',
  },
  {
    id: 'ember-low-hp',
    speaker: 'ember',
    trigger: 'lowHp',
    text: "You're bleeding. Move, Ash. MOVE.",
  },
  {
    id: 'ember-troops-cleared',
    speaker: 'ember',
    trigger: 'troopsCleared',
    text: 'Four down... wait. Ash, someone else is on this channel.',
  },
  {
    id: 'valor-intro',
    speaker: 'valor',
    trigger: 'bossIntro',
    text: "There you are. My crew, my village, and now my blade in your hand. Cinder, bring it back to me.",
  },
  {
    id: 'cinder-phase2',
    speaker: 'cinder',
    trigger: 'bossPhase2',
    text: 'You want to know what the fire looked like? Look closer.',
  },
  {
    id: 'valor-phase3',
    speaker: 'valor',
    trigger: 'bossPhase3',
    text: 'Stop playing with it, Cinder.',
  },
  {
    id: 'valor-hero-down',
    speaker: 'valor',
    trigger: 'heroDown',
    text: 'Leave the body. Bring my blade.',
  },
  {
    id: 'valor-zone-clear',
    speaker: 'valor',
    trigger: 'zoneClear',
    text: '...So it chose you. Keep it warm for me, ember-rat. I burn everything I own.',
  },
  {
    id: 'ember-zone-clear',
    speaker: 'ember',
    trigger: 'zoneClearTag',
    text: 'That voice. Ash... that was him. That was Valor.',
  },
];

export function linesFor(trigger: PresenceTrigger): PresenceLine[] {
  return PRESENCE_LINES.filter((l) => l.trigger === trigger);
}
