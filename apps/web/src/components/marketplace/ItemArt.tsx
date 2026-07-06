'use client'

import { Sparkles } from 'lucide-react'
import type { Item } from '@/types'
import { gunIdFromItemId } from './GunIcons'

const ATTACHMENT_SLOTS = ['barrel', 'optic', 'grip', 'magazine']

/**
 * Catalogue art: every item resolves to a baked render of its REAL in-game
 * asset (public/items/*.png, produced from the same meshes the fight uses),
 * so what you see in the shop is exactly what you get. Cosmetics fall back
 * to an icon until they have models.
 */
export function itemArtSrc(item: Item): string | null {
  const gid = gunIdFromItemId(item.id)
  if (gid) return `/items/gun_${gid}.png`
  const ws = item.weapon_stats as Record<string, unknown> | null
  switch (item.category) {
    case 'shield':
      return '/items/shield.png'
    case 'ammo':
      return ((ws?.burnDps as number) ?? 0) > 0 ? '/items/ammo_incendiary.png' : '/items/ammo_standard.png'
    case 'attachment': {
      const slot = ws?.slot as string | undefined
      return slot && ATTACHMENT_SLOTS.includes(slot) ? `/items/${slot}.png` : '/items/optic.png'
    }
    case 'booster':
      return '/items/booster.png'
    default:
      return null
  }
}

export function ItemArt({ item, color, size = 'card' }: { item: Item; color: string; size?: 'card' | 'modal' | 'banner' }) {
  const src = itemArtSrc(item)
  if (!src) {
    return size === 'card'
      ? <Sparkles size={40} strokeWidth={1.2} style={{ color }} />
      : <Sparkles size={28} strokeWidth={1.2} style={{ color }} className="shrink-0" />
  }
  const cls =
    size === 'card' ? 'h-28 w-full object-contain select-none'
    : size === 'banner' ? 'h-24 w-full object-contain select-none'
    : 'h-14 w-14 object-contain shrink-0 select-none'
  return (
    <img
      src={src}
      alt={item.name}
      draggable={false}
      className={cls}
      style={{ filter: `drop-shadow(0 6px 18px ${color}66)` }}
    />
  )
}
