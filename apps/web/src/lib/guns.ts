import { STARTER_GUN_ID, type GunId } from '@/engine/combat'
import type { InventoryItem } from '@/types'

/**
 * Join between marketplace items and the engine's gun catalog.
 *
 * Combat stats live in the typed GUN_CATALOG (engine/combat/GunStats.ts). A gun
 * sold in the marketplace is an `items` row whose fixed UUID maps to a gun id here.
 * These UUIDs MUST match supabase/migrations/004_guns.sql. The free starter sidearm
 * is the default loadout (not a sellable item), so it has no entry.
 */
export const GUN_ITEM_ID: Record<Exclude<GunId, 'sidearm'>, string> = {
  smg:           '22222222-2222-4222-8222-222222222222',
  assault_rifle: '33333333-3333-4333-8333-333333333333',
  marksman:      '44444444-4444-4444-8444-444444444444',
  legendary:     '55555555-5555-4555-8555-555555555555',
}

const ITEM_ID_TO_GUN: Record<string, GunId> = Object.fromEntries(
  Object.entries(GUN_ITEM_ID).map(([gun, id]) => [id, gun as GunId]),
)

/** True if a marketplace item is one of the gun tiers. */
export function isGunItem(itemId: string): boolean {
  return itemId in ITEM_ID_TO_GUN
}

/**
 * The gun a player fights with: their equipped weapon if it's a gun tier, else the
 * free starter sidearm. (Engine `GunStats` are looked up from the returned id.)
 */
export function equippedGunId(inventory: InventoryItem[]): GunId {
  const equipped = inventory.find((i) => i.equipped && ITEM_ID_TO_GUN[i.item_id])
  return equipped ? ITEM_ID_TO_GUN[equipped.item_id] : STARTER_GUN_ID
}
