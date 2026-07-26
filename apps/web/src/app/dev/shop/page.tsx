'use client';
import WeaponsShowcase from '@/components/marketplace/WeaponsShowcase';
import { GUN_ITEM_ID } from '@/lib/guns';
import type { Item } from '@/types';

/** Dev preview of the armoury listing with the real catalogue, including one weapon
 *  shown mid-season and the same weapon shown after the season has closed. */
const PRICES: Record<string, number> = {
  smg: 450, assault_rifle: 1200, marksman: 2700, legendary: 6000,
  ashfall_carbine: 3000, warden_repeater: 4500, rift_lance: 6500, seraph_lmg: 8000, ember_halo: 10000,
};
const SEASON_END = '2026-07-27T22:59:00Z';
const PAST = '2020-01-01T00:00:00Z';

function mk(gun: string, endsAt: string | null): Item {
  return {
    id: GUN_ITEM_ID[gun as keyof typeof GUN_ITEM_ID], name: gun, description: '',
    rarity: 'epic', category: 'weapon', stat_boost: 0, price_g: PRICES[gun],
    image_url: '', total_supply: null, remaining_supply: null,
    ...(endsAt ? { sale_ends_at: endsAt } : {}),
  } as unknown as Item;
}
const LIVE = Object.keys(PRICES).map((g) => mk(g, g === 'ember_halo' ? SEASON_END : null));
const AFTER = Object.keys(PRICES).map((g) => mk(g, g === 'ember_halo' ? PAST : null));

export default function DevShop() {
  return (
    <div style={{ minHeight: '100vh', background: '#04030c', padding: 20 }}>
      <WeaponsShowcase items={LIVE} walletAddress={undefined} />
      <div style={{ height: 32 }} />
      <p style={{ color: '#eab308', fontSize: 11, letterSpacing: 3, fontWeight: 700 }}>AFTER THE SEASON CLOSES</p>
      <WeaponsShowcase items={AFTER} walletAddress={undefined} />
    </div>
  );
}
