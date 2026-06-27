'use client'

import type { ReactElement } from 'react'
import type { GunId } from '@/engine/combat/GunStats'

interface GunIconProps {
  size?: number
  color?: string
  className?: string
}

function Sidearm({ size = 48, color = 'currentColor', className }: GunIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
      {/* Barrel */}
      <rect x="8" y="22" width="30" height="8" rx="2" fill={color} opacity={0.85} />
      {/* Slide */}
      <rect x="6" y="20" width="34" height="12" rx="3" stroke={color} strokeWidth="2" fill="none" />
      {/* Grip */}
      <path d="M32 32 L36 48 L28 48 L26 32 Z" fill={color} opacity={0.75} />
      {/* Trigger guard */}
      <path d="M26 32 Q26 40, 30 40 L34 40 Q36 40, 36 36" stroke={color} strokeWidth="1.5" fill="none" opacity={0.5} />
      {/* Muzzle */}
      <rect x="4" y="24" width="4" height="4" rx="1" fill={color} opacity={0.6} />
      {/* Sight */}
      <rect x="12" y="18" width="3" height="3" rx="0.5" fill={color} opacity={0.5} />
      <rect x="32" y="18" width="3" height="3" rx="0.5" fill={color} opacity={0.5} />
    </svg>
  )
}

function SMG({ size = 48, color = 'currentColor', className }: GunIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
      {/* Barrel + suppressor */}
      <rect x="4" y="20" width="16" height="6" rx="3" fill={color} opacity={0.6} />
      {/* Body */}
      <rect x="18" y="18" width="28" height="10" rx="2" fill={color} opacity={0.85} />
      <rect x="16" y="16" width="32" height="14" rx="3" stroke={color} strokeWidth="2" fill="none" />
      {/* Magazine */}
      <rect x="28" y="30" width="8" height="16" rx="1.5" fill={color} opacity={0.7} />
      {/* Grip */}
      <path d="M38 30 L42 46 L36 46 L34 30 Z" fill={color} opacity={0.65} />
      {/* Stock */}
      <path d="M48 20 L56 18 L56 22 L48 28 Z" fill={color} opacity={0.5} />
      {/* Sight */}
      <rect x="24" y="14" width="12" height="3" rx="1" fill={color} opacity={0.45} />
    </svg>
  )
}

function AssaultRifle({ size = 48, color = 'currentColor', className }: GunIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
      {/* Barrel */}
      <rect x="2" y="22" width="18" height="5" rx="2" fill={color} opacity={0.7} />
      {/* Handguard */}
      <rect x="12" y="20" width="14" height="9" rx="2" fill={color} opacity={0.6} />
      {/* Receiver */}
      <rect x="24" y="18" width="20" height="12" rx="2" fill={color} opacity={0.85} />
      <rect x="10" y="16" width="36" height="16" rx="3" stroke={color} strokeWidth="2" fill="none" />
      {/* Magazine */}
      <rect x="30" y="32" width="7" height="14" rx="1" fill={color} opacity={0.7} transform="rotate(5, 33, 39)" />
      {/* Stock */}
      <path d="M46 18 L58 16 L60 20 L58 28 L46 30 Z" fill={color} opacity={0.55} />
      {/* Grip */}
      <path d="M40 30 L44 46 L38 46 L36 30 Z" fill={color} opacity={0.65} />
      {/* Carry handle / sight */}
      <rect x="28" y="13" width="10" height="4" rx="1.5" fill={color} opacity={0.45} />
      {/* Muzzle flash hint */}
      <circle cx="3" cy="24.5" r="2" fill={color} opacity={0.3} />
    </svg>
  )
}

function Marksman({ size = 48, color = 'currentColor', className }: GunIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
      {/* Long barrel */}
      <rect x="2" y="23" width="26" height="4" rx="2" fill={color} opacity={0.7} />
      {/* Receiver */}
      <rect x="26" y="20" width="18" height="10" rx="2" fill={color} opacity={0.85} />
      <rect x="2" y="18" width="44" height="14" rx="3" stroke={color} strokeWidth="2" fill="none" />
      {/* Scope */}
      <rect x="18" y="12" width="18" height="6" rx="3" fill={color} opacity={0.65} />
      <circle cx="18" cy="15" r="3" stroke={color} strokeWidth="1.5" fill="none" opacity={0.5} />
      <circle cx="36" cy="15" r="2.5" stroke={color} strokeWidth="1.5" fill="none" opacity={0.5} />
      {/* Scope mount */}
      <rect x="24" y="16" width="2" height="3" fill={color} opacity={0.4} />
      <rect x="32" y="16" width="2" height="3" fill={color} opacity={0.4} />
      {/* Stock */}
      <path d="M46 20 L60 18 L62 22 L60 30 L46 30 Z" fill={color} opacity={0.55} />
      {/* Grip */}
      <path d="M38 30 L42 46 L36 46 L34 30 Z" fill={color} opacity={0.6} />
      {/* Bipod hint */}
      <line x1="10" y1="32" x2="6" y2="42" stroke={color} strokeWidth="1.5" opacity={0.35} />
      <line x1="16" y1="32" x2="20" y2="42" stroke={color} strokeWidth="1.5" opacity={0.35} />
    </svg>
  )
}

function Legendary({ size = 48, color = 'currentColor', className }: GunIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
      {/* Barrel with compensator */}
      <rect x="2" y="22" width="20" height="6" rx="2" fill={color} opacity={0.75} />
      <rect x="2" y="20" width="4" height="10" rx="1" fill={color} opacity={0.5} />
      {/* Body — angular, aggressive */}
      <path d="M20 16 L48 14 L50 20 L50 30 L48 34 L20 32 Z" fill={color} opacity={0.85} />
      <path d="M18 14 L50 12 L52 20 L52 32 L50 36 L18 34 Z" stroke={color} strokeWidth="2" fill="none" />
      {/* Integrated optic */}
      <path d="M26 10 L42 8 L42 14 L26 16 Z" fill={color} opacity={0.6} />
      <circle cx="28" cy="13" r="2" stroke={color} strokeWidth="1.2" fill="none" opacity={0.5} />
      {/* Extended magazine */}
      <rect x="32" y="34" width="8" height="18" rx="1.5" fill={color} opacity={0.7} />
      {/* Stock — folding */}
      <path d="M50 16 L58 14 L60 16 L60 26 L58 30 L50 32 Z" fill={color} opacity={0.5} />
      {/* Foregrip */}
      <rect x="22" y="32" width="4" height="8" rx="1" fill={color} opacity={0.5} />
      {/* Energy glow lines */}
      <line x1="22" y1="22" x2="46" y2="20" stroke={color} strokeWidth="1" opacity={0.4} />
      <line x1="22" y1="28" x2="46" y2="26" stroke={color} strokeWidth="1" opacity={0.4} />
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
