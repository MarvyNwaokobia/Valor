'use client'

import type { ReactElement } from 'react'
import type { GunId } from '@/engine/combat/GunStats'

interface GunIconProps {
  size?: number
  color?: string
  className?: string
}

function Sidearm({ size = 48, color = 'currentColor', className }: GunIconProps) {
  const s = size / 80
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" className={className}>
      <g transform={`scale(${s})`} style={{ transformOrigin: 'center' }}>
        {/* Slide — main body */}
        <path d="M10 28 L10 24 Q10 22, 12 22 L50 22 Q52 22, 52 24 L52 32 Q52 34, 50 34 L38 34 L36 34 Z" fill={color} opacity={0.9} />
        {/* Barrel */}
        <rect x="6" y="25" width="6" height="4" rx="1" fill={color} opacity={0.7} />
        {/* Muzzle */}
        <rect x="3" y="26" width="4" height="2" rx="0.5" fill={color} opacity={0.5} />
        {/* Ejection port */}
        <rect x="30" y="23" width="8" height="3" rx="0.5" fill={color} opacity={0.4} />
        {/* Front sight */}
        <rect x="13" y="20" width="2" height="3" rx="0.5" fill={color} opacity={0.7} />
        {/* Rear sight */}
        <path d="M46 20 L44 22 L48 22 Z" fill={color} opacity={0.6} />
        {/* Frame / lower */}
        <path d="M20 34 L50 34 L50 38 L46 38 L46 36 L20 36 Z" fill={color} opacity={0.7} />
        {/* Trigger guard */}
        <path d="M30 36 L30 42 Q30 46, 34 46 L40 46 Q42 46, 42 42 L42 38" stroke={color} strokeWidth="2" fill="none" opacity={0.6} />
        {/* Trigger */}
        <path d="M36 38 L34 44 L37 44 Z" fill={color} opacity={0.7} />
        {/* Grip */}
        <path d="M42 36 L52 36 L54 56 Q54 58, 52 58 L44 58 Q42 58, 42 56 Z" fill={color} opacity={0.8} />
        {/* Grip texture lines */}
        <line x1="44" y1="40" x2="52" y2="40" stroke={color} strokeWidth="0.8" opacity={0.3} />
        <line x1="44" y1="44" x2="52" y2="44" stroke={color} strokeWidth="0.8" opacity={0.3} />
        <line x1="44" y1="48" x2="53" y2="48" stroke={color} strokeWidth="0.8" opacity={0.3} />
        <line x1="44" y1="52" x2="53" y2="52" stroke={color} strokeWidth="0.8" opacity={0.3} />
        {/* Magazine base */}
        <rect x="43" y="56" width="10" height="3" rx="1" fill={color} opacity={0.6} />
        {/* Slide serrations */}
        {[40, 42, 44, 46].map(x => (
          <line key={x} x1={x} y1="23" x2={x} y2="33" stroke={color} strokeWidth="0.7" opacity={0.25} />
        ))}
      </g>
    </svg>
  )
}

function SMG({ size = 48, color = 'currentColor', className }: GunIconProps) {
  const s = size / 80
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" className={className}>
      <g transform={`scale(${s})`} style={{ transformOrigin: 'center' }}>
        {/* Barrel shroud */}
        <rect x="2" y="22" width="20" height="7" rx="2" fill={color} opacity={0.7} />
        {/* Barrel vent holes */}
        {[6, 10, 14, 18].map(x => (
          <circle key={x} cx={x} cy={25.5} r="1.2" fill="black" opacity={0.25} />
        ))}
        {/* Upper receiver */}
        <path d="M20 18 L56 18 Q58 18, 58 20 L58 30 Q58 32, 56 32 L20 32 Z" fill={color} opacity={0.9} />
        {/* Charging handle */}
        <rect x="44" y="16" width="6" height="3" rx="1" fill={color} opacity={0.6} />
        {/* Bolt */}
        <rect x="24" y="20" width="12" height="4" rx="0.5" fill={color} opacity={0.35} />
        {/* Lower receiver */}
        <path d="M24 32 L56 32 L56 36 L40 36 L24 36 Z" fill={color} opacity={0.75} />
        {/* Magazine — straight stick mag */}
        <rect x="30" y="36" width="7" height="22" rx="1.5" fill={color} opacity={0.8} />
        <line x1="31" y1="42" x2="36" y2="42" stroke={color} strokeWidth="0.6" opacity={0.3} />
        <line x1="31" y1="46" x2="36" y2="46" stroke={color} strokeWidth="0.6" opacity={0.3} />
        <line x1="31" y1="50" x2="36" y2="50" stroke={color} strokeWidth="0.6" opacity={0.3} />
        {/* Magazine base */}
        <rect x="29" y="56" width="9" height="3" rx="0.5" fill={color} opacity={0.6} />
        {/* Pistol grip */}
        <path d="M46 34 L56 34 L58 52 Q58 54, 56 54 L48 54 Q46 54, 46 52 Z" fill={color} opacity={0.8} />
        {/* Grip texture */}
        {[40, 44, 48].map(y => (
          <line key={y} x1="48" y1={y} x2="56" y2={y} stroke={color} strokeWidth="0.7" opacity={0.25} />
        ))}
        {/* Trigger guard */}
        <path d="M38 34 L38 42 Q38 44, 40 44 L44 44 Q46 44, 46 42 L46 36" stroke={color} strokeWidth="1.5" fill="none" opacity={0.5} />
        {/* Trigger */}
        <path d="M42 36 L40 42 L43 42 Z" fill={color} opacity={0.6} />
        {/* Folding stock */}
        <path d="M58 20 L64 18 L66 20 L66 22 L64 24 L58 30" stroke={color} strokeWidth="2.5" fill="none" opacity={0.5} strokeLinecap="round" />
        {/* Stock end plate */}
        <rect x="64" y="17" width="3" height="8" rx="1" fill={color} opacity={0.45} />
        {/* Front sight post */}
        <rect x="5" y="19" width="2" height="4" rx="0.5" fill={color} opacity={0.65} />
        {/* Rear sight */}
        <rect x="50" y="16" width="4" height="3" rx="0.5" fill={color} opacity={0.5} />
        {/* Muzzle */}
        <rect x="0" y="23" width="3" height="3" rx="0.5" fill={color} opacity={0.5} />
      </g>
    </svg>
  )
}

function AssaultRifle({ size = 48, color = 'currentColor', className }: GunIconProps) {
  const s = size / 80
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" className={className}>
      <g transform={`scale(${s})`} style={{ transformOrigin: 'center' }}>
        {/* Flash hider */}
        <path d="M0 24 L4 22 L4 28 L0 26 Z" fill={color} opacity={0.6} />
        {/* Barrel */}
        <rect x="3" y="23" width="16" height="4" rx="1" fill={color} opacity={0.7} />
        {/* Gas tube */}
        <rect x="12" y="21" width="14" height="2" rx="0.5" fill={color} opacity={0.5} />
        {/* Handguard — quad rail style */}
        <path d="M14 20 L28 20 L28 30 L14 30 Z" fill={color} opacity={0.75} />
        {/* Rail lines on handguard */}
        {[22, 24, 26, 28].map(y => (
          <line key={y} x1="15" y1={y} x2="27" y2={y} stroke={color} strokeWidth="0.5" opacity={0.3} />
        ))}
        {/* Upper receiver */}
        <path d="M26 17 L54 17 Q56 17, 56 19 L56 27 L26 27 Z" fill={color} opacity={0.9} />
        {/* Flat top rail */}
        <rect x="26" y="15" width="28" height="3" rx="0.5" fill={color} opacity={0.55} />
        {/* Rail notches */}
        {[28, 31, 34, 37, 40, 43, 46, 49].map(x => (
          <line key={x} x1={x} y1="15.5" x2={x} y2="17.5" stroke={color} strokeWidth="0.5" opacity={0.3} />
        ))}
        {/* Dust cover / ejection port */}
        <rect x="34" y="19" width="10" height="4" rx="0.5" fill={color} opacity={0.35} />
        {/* Forward assist */}
        <rect x="46" y="19" width="3" height="3" rx="1" fill={color} opacity={0.5} />
        {/* Lower receiver */}
        <path d="M28 27 L56 27 L56 32 L44 32 L28 32 Z" fill={color} opacity={0.8} />
        {/* Magazine well + curved magazine */}
        <path d="M32 32 L40 32 L42 54 Q42 56, 40 56 L30 54 Q28 54, 29 52 Z" fill={color} opacity={0.8} />
        {/* Mag texture */}
        <line x1="31" y1="38" x2="40" y2="38" stroke={color} strokeWidth="0.6" opacity={0.3} />
        <line x1="31" y1="44" x2="41" y2="44" stroke={color} strokeWidth="0.6" opacity={0.3} />
        <line x1="30" y1="50" x2="41" y2="50" stroke={color} strokeWidth="0.6" opacity={0.3} />
        {/* Trigger guard */}
        <path d="M34 32 L34 38 Q34 40, 36 40 L42 40 Q44 40, 44 38 L44 32" stroke={color} strokeWidth="1.5" fill="none" opacity={0.5} />
        {/* Trigger */}
        <path d="M39 33 L37 38 L40 38 Z" fill={color} opacity={0.65} />
        {/* Pistol grip — A2 style */}
        <path d="M46 30 L56 30 L58 50 Q58 52, 56 52 L48 52 Q46 52, 46 50 Z" fill={color} opacity={0.8} />
        {/* Grip texture */}
        {[36, 40, 44, 48].map(y => (
          <line key={y} x1="48" y1={y} x2="56" y2={y} stroke={color} strokeWidth="0.7" opacity={0.25} />
        ))}
        {/* Buffer tube */}
        <rect x="56" y="19" width="12" height="5" rx="2" fill={color} opacity={0.6} />
        {/* Stock — M4 collapsible */}
        <path d="M66 16 L76 16 Q78 16, 78 18 L78 28 Q78 30, 76 30 L66 30 Z" fill={color} opacity={0.55} />
        {/* Stock butt pad */}
        <rect x="76" y="17" width="2" height="12" rx="0.5" fill={color} opacity={0.4} />
        {/* Front sight */}
        <path d="M16 18 L16 21 L18 21 L18 18 L17 16 Z" fill={color} opacity={0.65} />
      </g>
    </svg>
  )
}

function Marksman({ size = 48, color = 'currentColor', className }: GunIconProps) {
  const s = size / 80
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" className={className}>
      <g transform={`scale(${s})`} style={{ transformOrigin: 'center' }}>
        {/* Muzzle brake */}
        <path d="M0 24 L5 22 L5 28 L0 26 Z" fill={color} opacity={0.6} />
        <line x1="2" y1="22" x2="2" y2="28" stroke={color} strokeWidth="0.5" opacity={0.3} />
        {/* Long barrel */}
        <rect x="4" y="23" width="24" height="4" rx="1" fill={color} opacity={0.7} />
        {/* Free-float handguard */}
        <path d="M16 20 L30 20 L30 30 L16 30 Z" fill={color} opacity={0.65} />
        {/* M-LOK slots */}
        {[19, 23, 27].map(x => (
          <rect key={x} x={x} y="27" width="3" height="1.5" rx="0.5" fill="black" opacity={0.2} />
        ))}
        {/* Upper receiver */}
        <path d="M28 18 L56 18 Q58 18, 58 20 L58 28 L28 28 Z" fill={color} opacity={0.9} />
        {/* Flat top rail */}
        <rect x="28" y="16" width="28" height="3" rx="0.5" fill={color} opacity={0.5} />
        {/* Scope — large, dominant */}
        <g opacity={0.85}>
          {/* Scope tube */}
          <rect x="22" y="8" width="28" height="8" rx="4" fill={color} opacity={0.7} />
          {/* Front objective lens */}
          <circle cx="23" cy="12" r="5" stroke={color} strokeWidth="1.5" fill="none" opacity={0.6} />
          <circle cx="23" cy="12" r="3" stroke={color} strokeWidth="0.5" fill="none" opacity={0.3} />
          {/* Rear eyepiece */}
          <circle cx="49" cy="12" r="3.5" stroke={color} strokeWidth="1.5" fill="none" opacity={0.55} />
          {/* Turret knobs */}
          <rect x="33" y="5" width="4" height="4" rx="1" fill={color} opacity={0.6} />
          <rect x="38" y="6" width="4" height="3" rx="1" fill={color} opacity={0.5} />
          {/* Scope rings / mounts */}
          <rect x="26" y="14" width="4" height="4" rx="0.5" fill={color} opacity={0.5} />
          <rect x="42" y="14" width="4" height="4" rx="0.5" fill={color} opacity={0.5} />
        </g>
        {/* Lower receiver */}
        <path d="M30 28 L58 28 L58 32 L44 32 L30 32 Z" fill={color} opacity={0.8} />
        {/* Magazine — short box mag */}
        <rect x="34" y="32" width="8" height="14" rx="1" fill={color} opacity={0.75} />
        <line x1="35" y1="38" x2="41" y2="38" stroke={color} strokeWidth="0.5" opacity={0.3} />
        <line x1="35" y1="42" x2="41" y2="42" stroke={color} strokeWidth="0.5" opacity={0.3} />
        {/* Trigger guard */}
        <path d="M36 32 L36 38 Q36 40, 38 40 L42 40 Q44 40, 44 38 L44 32" stroke={color} strokeWidth="1.5" fill="none" opacity={0.5} />
        {/* Trigger */}
        <path d="M40 33 L38 38 L41 38 Z" fill={color} opacity={0.6} />
        {/* Grip — target style, vertical */}
        <path d="M48 30 L56 30 L56 50 Q56 52, 54 52 L50 52 Q48 52, 48 50 Z" fill={color} opacity={0.8} />
        {/* Grip texture */}
        {[36, 40, 44, 48].map(y => (
          <line key={y} x1="49" y1={y} x2="55" y2={y} stroke={color} strokeWidth="0.6" opacity={0.25} />
        ))}
        {/* Precision stock — thumbhole style */}
        <path d="M58 18 L68 16 Q70 16, 72 18 L74 22 Q76 26, 74 28 L68 30 L58 28 Z" fill={color} opacity={0.55} />
        {/* Cheek riser */}
        <rect x="60" y="16" width="8" height="4" rx="1" fill={color} opacity={0.4} />
        {/* Butt pad */}
        <rect x="72" y="18" width="3" height="10" rx="1" fill={color} opacity={0.4} />
        {/* Bipod — folded */}
        <line x1="18" y1="30" x2="14" y2="40" stroke={color} strokeWidth="2" opacity={0.45} strokeLinecap="round" />
        <line x1="22" y1="30" x2="26" y2="40" stroke={color} strokeWidth="2" opacity={0.45} strokeLinecap="round" />
        {/* Bipod feet */}
        <rect x="12" y="39" width="4" height="2" rx="0.5" fill={color} opacity={0.35} />
        <rect x="24" y="39" width="4" height="2" rx="0.5" fill={color} opacity={0.35} />
      </g>
    </svg>
  )
}

function Legendary({ size = 48, color = 'currentColor', className }: GunIconProps) {
  const s = size / 80
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" className={className}>
      <g transform={`scale(${s})`} style={{ transformOrigin: 'center' }}>
        {/* Integrated suppressor / barrel */}
        <rect x="0" y="21" width="18" height="8" rx="4" fill={color} opacity={0.65} />
        {/* Suppressor porting */}
        {[4, 8, 12].map(x => (
          <circle key={x} cx={x} cy={25} r="1" fill="black" opacity={0.2} />
        ))}
        {/* Bullpup body — angular, futuristic */}
        <path d="M16 16 L62 14 Q64 14, 64 16 L64 30 Q64 32, 62 32 L16 34 Z" fill={color} opacity={0.9} />
        {/* Top rail — full length */}
        <rect x="16" y="12" width="46" height="3" rx="0.5" fill={color} opacity={0.55} />
        {/* Rail notches */}
        {[18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57].map(x => (
          <line key={x} x1={x} y1="12.5" x2={x} y2="14.5" stroke={color} strokeWidth="0.4" opacity={0.3} />
        ))}
        {/* Integrated holographic sight */}
        <g opacity={0.75}>
          <rect x="22" y="6" width="14" height="7" rx="2" fill={color} opacity={0.6} />
          <rect x="24" y="8" width="10" height="3" rx="1" fill="black" opacity={0.3} />
          {/* Reticle dot */}
          <circle cx="29" cy="9.5" r="0.8" fill={color} opacity={0.8} />
        </g>
        {/* Ejection port — forward */}
        <rect x="22" y="18" width="6" height="3" rx="0.5" fill={color} opacity={0.3} />
        {/* Ambidextrous controls */}
        <circle cx="32" cy="20" r="1.5" fill={color} opacity={0.4} />
        <rect x="34" y="19" width="3" height="2" rx="0.5" fill={color} opacity={0.35} />
        {/* Foregrip — angled */}
        <path d="M24 34 L28 34 L30 44 Q30 46, 28 46 L24 46 Q22 46, 22 44 Z" fill={color} opacity={0.7} />
        {/* Trigger — forward position (bullpup) */}
        <path d="M30 32 L30 38 Q30 40, 32 40 L36 40 Q38 40, 38 38 L38 34" stroke={color} strokeWidth="1.5" fill="none" opacity={0.5} />
        <path d="M34 34 L32 38 L35 38 Z" fill={color} opacity={0.6} />
        {/* Magazine — behind the grip (bullpup) */}
        <rect x="46" y="32" width="8" height="18" rx="1.5" fill={color} opacity={0.8} />
        <line x1="47" y1="38" x2="53" y2="38" stroke={color} strokeWidth="0.6" opacity={0.3} />
        <line x1="47" y1="42" x2="53" y2="42" stroke={color} strokeWidth="0.6" opacity={0.3} />
        <line x1="47" y1="46" x2="53" y2="46" stroke={color} strokeWidth="0.6" opacity={0.3} />
        {/* Mag baseplate */}
        <rect x="45" y="48" width="10" height="3" rx="0.5" fill={color} opacity={0.6} />
        {/* Stock — integrated, short (bullpup) */}
        <path d="M58 16 L70 14 Q72 14, 72 16 L72 28 Q72 30, 70 30 L58 30 Z" fill={color} opacity={0.6} />
        {/* Cheek weld */}
        <rect x="60" y="14" width="8" height="4" rx="1.5" fill={color} opacity={0.45} />
        {/* Butt pad — rubber */}
        <rect x="70" y="16" width="3" height="12" rx="1" fill={color} opacity={0.45} />
        {/* Energy accent lines — weapon has glow */}
        <line x1="18" y1="20" x2="56" y2="18" stroke={color} strokeWidth="0.8" opacity={0.35} />
        <line x1="18" y1="28" x2="56" y2="26" stroke={color} strokeWidth="0.8" opacity={0.35} />
        {/* Status LED indicators on side */}
        <circle cx="40" cy="22" r="1" fill={color} opacity={0.7} />
        <circle cx="44" cy="22" r="1" fill={color} opacity={0.5} />
        <circle cx="48" cy="22" r="1" fill={color} opacity={0.3} />
      </g>
    </svg>
  )
}

const GUN_ICON_MAP: Record<GunId, (props: GunIconProps) => ReactElement> = {
  sidearm: Sidearm,
  smg: SMG,
  assault_rifle: AssaultRifle,
  marksman: Marksman,
  legendary: Legendary,
}

export function GunIcon({ gunId, ...props }: GunIconProps & { gunId: GunId }) {
  const Icon = GUN_ICON_MAP[gunId]
  return <Icon {...props} />
}

export function gunIdFromItemId(itemId: string): GunId | null {
  const map: Record<string, GunId> = {
    '22222222-2222-4222-8222-222222222222': 'smg',
    '33333333-3333-4333-8333-333333333333': 'assault_rifle',
    '44444444-4444-4444-8444-444444444444': 'marksman',
    '55555555-5555-4555-8555-555555555555': 'legendary',
  }
  return map[itemId] ?? null
}
