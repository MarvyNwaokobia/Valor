-- ============================================================
-- 009 · Field Kit — purchasable tactical gear for the loadout
-- ============================================================
-- Flashlight / Night Vision / Laser were free "standard-issue" toggles; make
-- them ownable gear you buy in the Marketplace and bring in the Loadout. Sold
-- OFF-CHAIN like ammo + attachments (no on_chain_id) — the purchase-relay records
-- these directly (see apps/api/src/handlers/items.rs). weapon_stats.kit_id maps
-- to the engine's tactical attachment (FpsSim Attachment: 'light'|'nvg'|'laser').

-- 1. Allow the new 'gear' category.
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_category_check;
ALTER TABLE items ADD CONSTRAINT items_category_check
  CHECK (category IN ('weapon', 'shield', 'booster', 'cosmetic', 'ammo', 'attachment', 'gear'));

-- 2. Seed the field kit (off-chain — no on_chain_id).
INSERT INTO items (id, name, description, rarity, category, stat_boost, price_g, image_url, weapon_stats)
VALUES
  ('cccc0001-cccc-4ccc-8ccc-cccccccccc01', 'Tactical Flashlight',
   'A barrel-mounted flashlight — throws a forward light cone so you can push dark rooms without night vision.',
   'common', 'gear', 0, 90, '',
   '{"kit_id":"light"}'),

  ('cccc0002-cccc-4ccc-8ccc-cccccccccc02', 'Night Vision Goggles',
   'Head-mounted NVG — lifts the dark on night operations so the whole field reads in green.',
   'rare', 'gear', 0, 350, '',
   '{"kit_id":"nvg"}'),

  ('cccc0003-cccc-4ccc-8ccc-cccccccccc03', 'Laser Sight',
   'An under-barrel laser — tightens hip-fire so snap shots land without aiming down sights.',
   'common', 'gear', 0, 140, '',
   '{"kit_id":"laser"}')
ON CONFLICT (id) DO NOTHING;
