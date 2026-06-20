// ── Combat tuning constants ──────────────────────────────────────────────────

/** Starting / max HP for all fighters */
export const MAX_HP = 100

/** Starting / max stamina */
export const MAX_STAMINA = 100

/** Stamina regeneration per second while idle */
export const STAMINA_REGEN_PER_SEC = 15

/** Stamina regeneration per second while blocking */
export const STAMINA_REGEN_BLOCKING = 5

/** Stamina cost to dodge */
export const DODGE_STAMINA_COST = 20

/** Dodge duration in ms */
export const DODGE_DURATION_MS = 300

/** Dodge invincibility window (i-frames) in ms */
export const DODGE_IFRAMES_MS = 200

/** Dodge travel distance (Three.js units) */
export const DODGE_DISTANCE = 0.4

/** Block damage reduction multiplier */
export const BLOCK_DAMAGE_REDUCTION = 0.8

/** Stamina cost per blocked hit */
export const BLOCK_STAMINA_COST = 12

/** Consecutive blocks before guard breaks */
export const GUARD_BREAK_THRESHOLD = 4

/** Guard break stun duration (ms) */
export const GUARD_BREAK_STUN_MS = 800

/** Hit range — max distance between fighters for a hit to connect */
export const HIT_RANGE = 1.6

/** Resting distance between fighters (X axis) */
export const FIGHTER_SPACING = 1.4

/** Player base X position */
export const PLAYER_BASE_X = -0.7

/** Bot base X position */
export const BOT_BASE_X = 0.7

/** Special meter gained per damage dealt */
export const SPECIAL_METER_PER_DMG_DEALT = 1.5

/** Special meter gained per damage taken */
export const SPECIAL_METER_PER_DMG_TAKEN = 2.0

/** Special meter required to use special */
export const SPECIAL_METER_THRESHOLD = 80

/** Combo damage multiplier: base + (comboCount * increment) */
export const COMBO_DAMAGE_BASE = 1.0
export const COMBO_DAMAGE_INCREMENT = 0.12

/** Max combo multiplier cap */
export const COMBO_DAMAGE_CAP = 2.0

/** Combo window — time after a hit lands where the next input chains (ms) */
export const COMBO_WINDOW_MS = 400

/** Combo drop — if no follow-up input in this window, combo resets */
export const COMBO_DROP_MS = 800

/** Slow-mo duration on KO hit (ms) */
export const KO_SLOWMO_MS = 800

/** Slow-mo time scale (0.2 = 5× slower) */
export const KO_SLOWMO_SCALE = 0.2

/** Intro sequence duration (ms) */
export const INTRO_DURATION_MS = 2000

/** Delay before result screen after KO (ms) */
export const KO_TO_RESULT_DELAY_MS = 1500

/** Fight time limit (ms) — if nobody dies, higher HP wins */
export const FIGHT_TIME_LIMIT_MS = 60_000

// ── Bot AI tuning ────────────────────────────────────────────────────────────

/** Bot minimum time between actions (ms) */
export const BOT_ACTION_COOLDOWN_MS = 400

/** Bot reaction time range by difficulty [min, max] (ms) */
export const BOT_REACTION_RANGE: Record<string, [number, number]> = {
  Bronze:   [600, 1200],
  Silver:   [450, 900],
  Gold:     [350, 700],
  Platinum: [250, 550],
  Diamond:  [180, 400],
}
