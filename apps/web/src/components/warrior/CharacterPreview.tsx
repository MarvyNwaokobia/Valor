'use client'

import { motion } from 'framer-motion'
import type { CharacterClass } from '@/lib/classes'
import { CLASS_DEFINITIONS } from '@/lib/classes'

export interface CharacterConfig {
  characterClass: CharacterClass
  skinTone: string
  hairStyle: number   // 0=crop 1=spiky 2=long 3=topknot 4=bald
  hairColor: string
}

interface Props extends CharacterConfig {
  animated?: boolean
  height?: number | string
}

/** Darken a hex color. factor 0=black, 1=unchanged */
function dk(hex: string, f: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`
}

const ARMOR: Record<CharacterClass, { m: string; d: string; l: string; ml: string }> = {
  Berserker: { m: '#7a1515', d: '#3d0808', l: '#a01818', ml: '#9a8070' },
  Sentinel:  { m: '#1a3860', d: '#0d2040', l: '#2850a0', ml: '#90a8c0' },
  Phantom:   { m: '#2c1448', d: '#180c2e', l: '#4c2080', ml: '#8070c0' },
}

export default function CharacterPreview({ characterClass, skinTone, hairStyle, hairColor, animated = true, height = '100%' }: Props) {
  const def = CLASS_DEFINITIONS[characterClass]
  const ss = dk(skinTone, 0.72)
  const hd = dk(hairColor, 0.55)
  const ar = ARMOR[characterClass]

  return (
    <motion.svg
      viewBox="0 0 220 440"
      style={{
        height,
        width: 'auto',
        overflow: 'visible',
        filter: `drop-shadow(0 0 24px ${def.glowColor}) drop-shadow(0 8px 20px rgba(0,0,0,0.95))`,
      }}
      animate={animated ? { y: [0, -7, 0] } : {}}
      transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
    >
      {characterClass === 'Berserker' && <BerserkerBody skin={skinTone} ss={ss} hc={hairColor} hd={hd} hs={hairStyle} ar={ar} />}
      {characterClass === 'Sentinel'  && <SentinelBody  skin={skinTone} ss={ss} hc={hairColor} hd={hd} hs={hairStyle} ar={ar} />}
      {characterClass === 'Phantom'   && <PhantomBody   skin={skinTone} ss={ss} hc={hairColor} hd={hd} hs={hairStyle} ar={ar} />}
    </motion.svg>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

interface CP { skin: string; ss: string; hc: string; hd: string; hs: number; ar: { m: string; d: string; l: string; ml: string } }

function Hair({ hc, hd, hs, cx, ty }: { hc: string; hd: string; hs: number; cx: number; ty: number }) {
  if (hs === 4) return null
  if (hs === 0) return (
    <g fill={hc}>
      <rect x={cx - 22} y={ty - 20} width="44" height="13" rx="7" />
      <ellipse cx={cx} cy={ty - 14} rx="22" ry="9" />
    </g>
  )
  if (hs === 1) return (
    <g>
      {([-16, -8, 0, 8, 16] as number[]).map((ox, i) => (
        <polygon key={i} points={`${cx + ox - 5},${ty - 11} ${cx + ox},${ty - 30 - (i === 2 ? 10 : i === 1 || i === 3 ? 5 : 0)} ${cx + ox + 5},${ty - 11}`} fill={hc} />
      ))}
      <ellipse cx={cx} cy={ty - 10} rx="22" ry="8" fill={hc} />
    </g>
  )
  if (hs === 2) return (
    <g>
      <ellipse cx={cx} cy={ty - 12} rx="22" ry="10" fill={hc} />
      <rect x={cx - 22} y={ty - 22} width="44" height="14" rx="6" fill={hc} />
      <path d={`M ${cx - 22} ${ty - 18} C ${cx - 30} ${ty + 24} ${cx - 28} ${ty + 74} ${cx - 22} ${ty + 95} L ${cx - 12} ${ty + 95} C ${cx - 18} ${ty + 74} ${cx - 20} ${ty + 22} ${cx - 12} ${ty - 14} Z`} fill={hc} />
      <path d={`M ${cx + 22} ${ty - 18} C ${cx + 30} ${ty + 24} ${cx + 28} ${ty + 74} ${cx + 22} ${ty + 95} L ${cx + 12} ${ty + 95} C ${cx + 18} ${ty + 74} ${cx + 20} ${ty + 22} ${cx + 12} ${ty - 14} Z`} fill={hc} />
    </g>
  )
  // hs === 3: topknot
  return (
    <g>
      <ellipse cx={cx} cy={ty - 10} rx="22" ry="8" fill={hc} />
      <rect x={cx - 5} y={ty - 44} width="10" height="36" rx="4" fill={hd} />
      <ellipse cx={cx} cy={ty - 46} rx="9" ry="8" fill={hc} />
    </g>
  )
}

function Face({ skin, ss, cx, cy }: { skin: string; ss: string; cx: number; cy: number }) {
  return (
    <g>
      {/* Ears */}
      <ellipse cx={cx - 23} cy={cy + 4} rx="4" ry="6" fill={skin} />
      <ellipse cx={cx + 23} cy={cy + 4} rx="4" ry="6" fill={skin} />
      {/* Head */}
      <ellipse cx={cx} cy={cy} rx="22" ry="26" fill={skin} />
      <ellipse cx={cx} cy={cy + 10} rx="22" ry="16" fill={ss} opacity="0.18" />
      {/* Brows */}
      <path d={`M ${cx - 12} ${cy - 9} Q ${cx - 7} ${cy - 13} ${cx - 2} ${cy - 9}`} stroke={ss} fill="none" strokeWidth="2.2" strokeLinecap="round" />
      <path d={`M ${cx + 2} ${cy - 9} Q ${cx + 7} ${cy - 13} ${cx + 12} ${cy - 9}`} stroke={ss} fill="none" strokeWidth="2.2" strokeLinecap="round" />
      {/* Eye whites */}
      <ellipse cx={cx - 7} cy={cy - 3} rx="5.5" ry="4.5" fill="rgba(255,255,255,0.94)" />
      <ellipse cx={cx + 7} cy={cy - 3} rx="5.5" ry="4.5" fill="rgba(255,255,255,0.94)" />
      {/* Irises */}
      <ellipse cx={cx - 7} cy={cy - 3} rx="3.5" ry="3.5" fill="#1c0808" />
      <ellipse cx={cx + 7} cy={cy - 3} rx="3.5" ry="3.5" fill="#1c0808" />
      {/* Pupils */}
      <ellipse cx={cx - 7} cy={cy - 3} rx="1.8" ry="1.8" fill="#080505" />
      <ellipse cx={cx + 7} cy={cy - 3} rx="1.8" ry="1.8" fill="#080505" />
      {/* Eye highlights */}
      <circle cx={cx - 5.5} cy={cy - 4.5} r="1.1" fill="rgba(255,255,255,0.95)" />
      <circle cx={cx + 8.5} cy={cy - 4.5} r="1.1" fill="rgba(255,255,255,0.95)" />
      {/* Nose */}
      <path d={`M ${cx} ${cy + 4} L ${cx - 3} ${cy + 9} Q ${cx} ${cy + 11} ${cx + 3} ${cy + 9}`} stroke={ss} fill="none" strokeWidth="1" strokeLinecap="round" />
      {/* Mouth */}
      <path d={`M ${cx - 7} ${cy + 15} Q ${cx} ${cy + 18} ${cx + 7} ${cy + 15}`} stroke="#7a2e2e" fill="none" strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

// ─── BERSERKER ────────────────────────────────────────────────────────────────

function BerserkerBody({ skin, ss, hc, hd, hs, ar }: CP) {
  return (
    <g>
      {/* War cloak (torn, behind) */}
      <path d="M 122 98 Q 170 126, 208 170 Q 226 216, 212 292 Q 198 356, 172 410 L 154 404 Q 178 352, 190 286 Q 203 214, 178 172 Q 150 133, 124 114 Z" fill={ar.d} />

      {/* Legs */}
      <path d="M 58 232 L 50 326 L 44 386 L 42 418 L 88 418 L 90 382 L 96 322 L 100 232 Z" fill={ar.m} />
      <path d="M 112 232 L 116 322 L 122 382 L 124 418 L 168 418 L 166 386 L 158 326 L 150 232 Z" fill={ar.m} />
      {/* Greave lines */}
      <rect x="55" y="280" width="40" height="5" rx="2" fill={ar.d} />
      <rect x="115" y="280" width="40" height="5" rx="2" fill={ar.d} />

      {/* Boots */}
      <path d="M 30 400 C 22 414, 20 430, 30 440 L 90 440 L 90 420 L 44 418 Z" fill={ar.d} />
      <path d="M 178 400 C 186 414, 188 430, 178 440 L 120 440 L 120 420 L 166 418 Z" fill={ar.d} />
      {/* Boot studs */}
      <rect x="48" y="426" width="34" height="5" rx="2" fill={ar.ml} />
      <rect x="128" y="426" width="34" height="5" rx="2" fill={ar.ml} />

      {/* Torso — wide iron armor */}
      <path d="M 42 100 L 34 158 L 32 212 L 40 232 L 172 232 L 180 212 L 178 158 L 166 100 Z" fill={ar.m} />
      {/* Chest plate face */}
      <path d="M 56 114 L 48 160 L 48 206 L 56 218 L 154 218 L 162 206 L 162 160 L 154 114 Z" fill={ar.d} />
      {/* Chest emblem */}
      <circle cx="105" cy="165" r="15" fill={ar.l} />
      <circle cx="105" cy="165" r="10" fill={ar.d} />
      <path d="M 99 160 L 105 155 L 111 160 L 111 170 L 105 175 L 99 170 Z" fill={ar.l} />

      {/* Pauldrons — spiked */}
      <path d="M 8 96 Q 28 80, 50 94 Q 58 112, 42 122 Q 22 132, 4 114 Z" fill={ar.m} />
      <path d="M 202 96 Q 182 80, 160 94 Q 152 112, 168 122 Q 188 132, 206 114 Z" fill={ar.m} />
      {/* Spikes on pauldrons */}
      <polygon points="10,94 4,76 18,82" fill={ar.l} />
      <polygon points="28,84 24,64 36,72" fill={ar.l} />
      <polygon points="200,94 206,76 192,82" fill={ar.l} />
      <polygon points="182,84 186,64 174,72" fill={ar.l} />

      {/* Left arm — lower axe grip */}
      <path d="M 40 102 L 22 130 L 10 162 L 8 194 L 26 200 L 38 170 L 50 138 L 58 108 Z" fill={ar.m} />
      {/* Left hand (skin) */}
      <ellipse cx="15" cy="202" rx="11" ry="9" fill={skin} />

      {/* Right arm — upper axe grip */}
      <path d="M 168 100 L 182 76 L 194 50 L 196 26 L 184 20 L 180 48 L 168 76 L 158 98 Z" fill={ar.m} />
      {/* Right hand (skin) */}
      <ellipse cx="190" cy="22" rx="11" ry="9" fill={skin} />

      {/* Neck (skin) */}
      <rect x="95" y="80" width="20" height="24" rx="5" fill={skin} />

      {/* Face (open helm — full face visible) */}
      <Face skin={skin} ss={ss} cx={105} cy={52} />

      {/* Warrior brow ridge / helm crown (minimal) */}
      <path d="M 82 28 C 82 20, 88 14, 105 12 C 122 14, 128 20, 128 28 L 128 34 Q 128 26 105 24 Q 82 26 82 34 Z" fill={ar.m} />

      {/* Hair */}
      <Hair hc={hc} hd={hd} hs={hs} cx={105} ty={28} />

      {/* ══ GREAT AXE ══ */}
      {/* Haft */}
      <path d="M 18 198 L 190 24 L 198 32 L 26 206 Z" fill="#5a3c18" />
      {/* Haft grip wrap */}
      {([0.2, 0.42, 0.64] as number[]).map((t, i) => (
        <line key={i}
          x1={18 + t * 172} y1={198 - t * 174}
          x2={18 + t * 172 + 9} y2={198 - t * 174 + 9}
          stroke="#8a6030" strokeWidth="3" strokeLinecap="round"
        />
      ))}
      {/* Axe head - double crescent */}
      <path d="M 180 18 C 175 4, 198 -16, 232 -2 C 258 10, 266 44, 242 62 C 224 76, 200 70, 188 56 C 205 50, 226 36, 224 16 C 220 0, 196 -2, 180 18 Z" fill={ar.ml} />
      <path d="M 180 18 C 170 30, 160 50, 166 68 L 180 60 C 172 48, 176 30, 188 24 Z" fill={ar.ml} />
      {/* Axe shine */}
      <path d="M 204 4 C 228 -6, 248 8, 244 32" stroke="rgba(255,255,255,0.35)" fill="none" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  )
}

// ─── SENTINEL ─────────────────────────────────────────────────────────────────

function SentinelBody({ skin, ss: _ss, hc: _hc, hd: _hd, hs: _hs, ar }: CP) {
  return (
    <g>
      {/* LEGS */}
      <path d="M 68 232 L 60 326 L 56 388 L 54 416 L 96 416 L 98 384 L 102 322 L 106 232 Z" fill={ar.m} />
      <path d="M 114 232 L 118 322 L 122 384 L 124 416 L 164 416 L 162 388 L 158 326 L 150 232 Z" fill={ar.m} />
      {/* Greave lines */}
      <rect x="62" y="275" width="40" height="5" rx="2" fill={ar.l} opacity="0.5" />
      <rect x="118" y="275" width="40" height="5" rx="2" fill={ar.l} opacity="0.5" />
      {/* Boots */}
      <path d="M 42 398 C 34 413, 32 430, 42 440 L 98 440 L 98 418 L 56 416 Z" fill={ar.d} />
      <path d="M 176 398 C 184 413, 186 430, 176 440 L 122 440 L 122 418 L 162 416 Z" fill={ar.d} />

      {/* TORSO — full plate */}
      <path d="M 56 100 L 48 158 L 46 215 L 54 232 L 162 232 L 170 215 L 168 158 L 158 100 Z" fill={ar.m} />
      <path d="M 68 114 L 62 160 L 62 210 L 68 224 L 148 224 L 154 210 L 154 160 L 148 114 Z" fill={ar.d} />
      {/* Sentinel cross */}
      <rect x="97" y="138" width="22" height="5" rx="2" fill={ar.l} />
      <rect x="106" y="124" width="4" height="32" rx="2" fill={ar.l} />

      {/* Pauldrons */}
      <path d="M 24 96 Q 42 80, 62 94 Q 70 112, 54 124 Q 36 134, 20 114 Z" fill={ar.m} />
      <path d="M 192 96 Q 174 80, 154 94 Q 146 112, 162 124 Q 180 134, 196 114 Z" fill={ar.m} />
      <path d="M 24 96 Q 42 80, 62 94" fill="none" stroke={ar.ml} strokeWidth="2.5" />
      <path d="M 192 96 Q 174 80, 154 94" fill="none" stroke={ar.ml} strokeWidth="2.5" />

      {/* Right arm + sword (guard position) */}
      <path d="M 158 102 L 170 78 L 180 54 L 178 30 L 170 24 L 168 52 L 158 78 L 150 100 Z" fill={ar.m} />
      {/* Sword blade */}
      <path d="M 172 28 L 200 -34 L 207 -30 L 178 36 Z" fill={ar.ml} />
      <path d="M 180 16 L 200 -28" stroke="rgba(255,255,255,0.45)" fill="none" strokeWidth="2" strokeLinecap="round" />
      {/* Crossguard */}
      <rect x="158" y="24" width="30" height="9" rx="2.5" transform="rotate(-22,173,28)" fill={ar.ml} />
      {/* Grip */}
      <rect x="165" y="33" width="10" height="24" rx="3" transform="rotate(-22,170,45)" fill="#4a3010" />
      {/* Pommel */}
      <ellipse cx="165" cy="60" rx="9" ry="7" fill={ar.ml} />
      <ellipse cx="165" cy="60" rx="5" ry="4" fill={ar.d} />

      {/* Left arm (holding shield) */}
      <path d="M 58 102 L 42 126 L 28 154 L 24 182 L 40 188 L 52 162 L 64 134 L 70 108 Z" fill={ar.m} />

      {/* TOWER SHIELD */}
      <path d="M -14 90 L -18 100 L -22 178 L -22 300 L -16 348 L -2 376 L 16 384 L 38 374 L 50 344 L 52 300 L 52 178 L 46 100 L 40 90 Z" fill={ar.d} opacity="0.5" transform="translate(5,7)" />
      <path d="M -14 90 L -18 100 L -22 178 L -22 300 L -16 348 L -2 376 L 16 384 L 38 374 L 50 344 L 52 300 L 52 178 L 46 100 L 40 90 Z" fill={ar.m} />
      <path d="M -10 102 L -14 178 L -14 296 L -8 340 L 5 362 L 16 368 L 30 360 L 42 336 L 46 296 L 46 178 L 40 102 Z" fill={ar.d} />
      {/* Shield boss */}
      <circle cx="16" cy="228" r="18" fill={ar.m} />
      <circle cx="16" cy="228" r="13" fill={ar.d} />
      <circle cx="16" cy="228" r="7" fill={ar.l} />
      <line x1="16" y1="148" x2="16" y2="316" stroke={ar.l} strokeWidth="3" opacity="0.4" />
      <line x1="-12" y1="232" x2="44" y2="232" stroke={ar.l} strokeWidth="3" opacity="0.4" />
      <path d="M -14 90 L -18 100 L -22 178 L -22 300 L -16 348 L -2 376 L 16 384 L 38 374 L 50 344 L 52 300 L 52 178 L 46 100 L 40 90 Z" fill="none" stroke={ar.l} strokeWidth="2" opacity="0.35" />

      {/* Neck */}
      <rect x="96" y="82" width="18" height="20" rx="4" fill={skin} />

      {/* Full plate HELM */}
      <path d="M 72 88 L 70 62 L 74 40 L 84 24 L 105 18 L 125 24 L 136 40 L 138 62 L 136 88 Z" fill={ar.m} />
      {/* Helm crest fin */}
      <path d="M 90 22 L 88 4 L 96 0 L 105 -2 L 122 0 L 128 4 L 124 22 Z" fill={ar.l} />
      <rect x="103" y="-2" width="4" height="24" rx="2" fill={ar.m} />
      {/* Visor slit */}
      <rect x="82" y="56" width="44" height="20" rx="3" fill="#080814" />
      {/* Eyes glowing in visor */}
      <ellipse cx="93" cy="66" rx="6" ry="5" fill="#121a2e" />
      <ellipse cx="117" cy="66" rx="6" ry="5" fill="#121a2e" />
      <ellipse cx="93" cy="66" rx="3.5" ry="3" fill={skin} opacity="0.25" />
      <ellipse cx="117" cy="66" rx="3.5" ry="3" fill={skin} opacity="0.25" />
      {/* Chin guard */}
      <path d="M 76 86 L 74 96 L 82 102 L 126 102 L 134 96 L 132 86 Z" fill={ar.m} />
      {/* Helm rim highlight */}
      <path d="M 72 88 L 70 62 L 74 40 L 84 24" fill="none" stroke={ar.ml} strokeWidth="1.5" opacity="0.4" />
      <path d="M 136 88 L 138 62 L 134 40 L 125 24" fill="none" stroke={ar.ml} strokeWidth="1.5" opacity="0.4" />
    </g>
  )
}

// ─── PHANTOM ──────────────────────────────────────────────────────────────────

function PhantomBody({ skin, ss: _ss, hc, hd: _hd, hs, ar }: CP) {
  return (
    <g>
      {/* Cloak — flowing, wide */}
      <path d="M 120 96 Q 176 126, 218 174 Q 242 226, 230 312 Q 216 384, 188 430 L 168 422 Q 196 378, 208 306 Q 218 226, 190 178 Q 158 134, 122 112 Z" fill={ar.d} />
      <path d="M 96 100 Q 56 128, 40 180 Q 26 234, 38 308 Q 50 374, 76 424 L 92 416 Q 68 366, 58 304 Q 46 228, 60 180 Q 76 132, 100 116 Z" fill={ar.d} />

      {/* Legs — slim */}
      <path d="M 74 236 L 66 330 L 62 388 L 60 420 L 98 420 L 100 384 L 104 326 L 108 236 Z" fill={ar.m} />
      <path d="M 116 236 L 120 326 L 124 384 L 126 420 L 162 420 L 160 388 L 156 330 L 148 236 Z" fill={ar.m} />
      {/* Boots */}
      <path d="M 48 402 C 40 416, 38 432, 48 440 L 100 440 L 100 422 L 62 420 Z" fill={ar.d} />
      <path d="M 170 402 C 178 416, 180 432, 170 440 L 124 440 L 124 422 L 158 420 Z" fill={ar.d} />

      {/* Torso — slim robes/armor */}
      <path d="M 66 100 L 58 158 L 56 216 L 64 236 L 158 236 L 166 216 L 164 158 L 150 100 Z" fill={ar.m} />
      <path d="M 78 114 L 72 160 L 70 212 L 78 228 L 146 228 L 154 212 L 152 160 L 144 114 Z" fill={ar.d} />
      {/* Arcane star on chest */}
      <circle cx="110" cy="168" r="13" fill={ar.m} />
      <path d="M 110 155 L 113 163 L 122 163 L 116 169 L 118 178 L 110 172 L 102 178 L 104 169 L 98 163 L 107 163 Z" fill={ar.l} />

      {/* Pauldrons */}
      <path d="M 40 96 Q 56 82, 70 96 Q 76 110, 64 120 Q 48 128, 34 110 Z" fill={ar.m} />
      <path d="M 178 96 Q 162 82, 148 96 Q 142 110, 156 120 Q 172 128, 186 110 Z" fill={ar.m} />

      {/* Right arm — forward thrust dagger */}
      <path d="M 150 102 L 163 80 L 174 56 L 176 32 L 168 26 L 163 52 L 152 78 L 144 100 Z" fill={ar.m} />
      {/* Forward dagger blade */}
      <path d="M 168 30 L 204 -32 L 210 -27 L 173 37 Z" fill={ar.ml} />
      <path d="M 177 18 L 205 -26" stroke="rgba(255,255,255,0.5)" fill="none" strokeWidth="2" strokeLinecap="round" />
      {/* Dagger guard */}
      <rect x="158" y="26" width="24" height="8" rx="2.5" transform="rotate(-24,170,30)" fill={ar.ml} />
      {/* Grip */}
      <rect x="165" y="34" width="9" height="19" rx="2.5" transform="rotate(-24,169,44)" fill="#1a0a30" />

      {/* Left arm — reverse grip dagger at hip */}
      <path d="M 70 102 L 52 124 L 38 150 L 34 178 L 50 184 L 60 158 L 72 130 L 80 108 Z" fill={ar.m} />
      <path d="M 38 176 L 8 232 L 16 238 L 46 184 Z" fill={ar.ml} />
      <path d="M 14 232 L 8 240" stroke="rgba(255,255,255,0.45)" fill="none" strokeWidth="2" strokeLinecap="round" />
      <rect x="30" y="172" width="22" height="8" rx="2.5" transform="rotate(22,41,176)" fill={ar.ml} />

      {/* Neck */}
      <rect x="95" y="84" width="20" height="20" rx="5" fill={skin} opacity="0.6" />

      {/* HOOD */}
      <path d="M 68 88 C 66 66, 72 44, 82 28 C 90 14, 102 6, 112 6 C 122 6, 134 14, 140 28 C 148 44, 152 66, 150 88 L 146 94 L 68 94 Z" fill={ar.d} />
      {/* Hood inner darkness */}
      <path d="M 76 88 C 74 70, 78 52, 86 38 C 92 26, 102 18, 112 18 C 122 18, 132 26, 138 38 C 144 52, 146 70, 144 88 Z" fill="#080410" />
      {/* Face — barely visible in shadow */}
      <ellipse cx="110" cy="60" rx="20" ry="24" fill={skin} opacity="0.3" />
      <ellipse cx="110" cy="68" rx="20" ry="16" fill="#0a0510" opacity="0.6" />
      {/* Glowing Phantom eyes */}
      <ellipse cx="100" cy="56" rx="6" ry="5" fill={ar.l} opacity="0.85" />
      <ellipse cx="120" cy="56" rx="6" ry="5" fill={ar.l} opacity="0.85" />
      <ellipse cx="100" cy="56" rx="3.5" ry="3" fill="rgba(255,255,255,0.45)" />
      <ellipse cx="120" cy="56" rx="3.5" ry="3" fill="rgba(255,255,255,0.45)" />
      {/* Hair peeking from hood sides */}
      {hs !== 4 && (
        <g fill={hc} opacity="0.75">
          <path d="M 72 66 C 70 50, 74 36, 82 28 L 86 33 C 80 41, 76 54, 78 66 Z" />
          <path d="M 148 66 C 150 50, 146 36, 138 28 L 134 33 C 140 41, 144 54, 142 66 Z" />
        </g>
      )}
    </g>
  )
}
