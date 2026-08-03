-- Reprice the Avalanche catalogue around the campaign-then-Endless progression.
--
-- THE MISTAKE THIS FIXES
-- ----------------------
-- The first pass priced everything against a flat "one clear = 100 SCRP" anchor
-- without checking what a player can actually earn. Campaign is FINITE: 15
-- operations, once each, 1,500 SCRP for a player's entire life. The entry gun was
-- 800 and the next one 1,500, so clearing the whole campaign bought one gun and
-- almost nothing else. Every other weapon sat behind Endless, which is gated on
-- finishing all 15 operations — deliberately, and correctly, because earning the
-- endgame mode is the progression the game intends.
--
-- So the prices move to fit the progression rather than the other way round.
--
-- CAMPAIGN TIER — a campaign that funds itself
--   The 1,500 SCRP a player earns across 15 ops should buy a working loadout, not
--   a single rifle. First gun now lands at op 3 rather than op 8.
--     Compact SMG        300   (3 ops)
--     Assault Rifle      600   (6 ops)
--     Marksman Rifle     900   (9 ops)
--   Attachments, ammo and boosters drop proportionally so a full kit is affordable
--   alongside a weapon.
--
-- ENDLESS TIER — explicitly endgame
--   These are meant to be out of reach until Endless is unlocked, and they still
--   are: the cheapest is 20 waves past the campaign and Ember Halo is 140.
--     Ashfall Carbine  2,000    Rift Lance   4,000
--     Warden's Rep.    2,500    Seraph       4,500
--     Valor Prototype  3,500    Ember Halo   5,000
--
--   Ember Halo came DOWN from 8,000. At the old price it was 320 waves, roughly
--   eight hours of Endless, in a game with one recorded Endless session ever. An
--   unreachable chase item is decoration; 140 waves is a real goal.
--
-- ⚠️ THE INVARIANT
-- The price here MUST equal the on-chain listing for the same (item, chain), or a
-- buyer signs a permit for one amount, the marketplace charges another, and
-- `permit()` rejects the signature after they have already approved it. Applying
-- this migration WITHOUT running contracts/script/RelistAvalancheItems.s.sol
-- breaks every SCRP purchase. Change them together, then verify chain against DB.

UPDATE item_chain_prices p
   SET price = v.price
  FROM items i,
       (VALUES
           -- boosters and consumables: buy several a session without thinking
           (7,    10::numeric), (8,   25),
           -- ammo
           (14,   25), (16,   25), (15,   50), (17,   75),
           -- attachments: a full kit affordable during the campaign
           (22,   75), (24,   75), (20,   75), (18,  100),
           (23,  150), (19,  175), (25,  175), (21,  200),
           -- gear
           (26,   75), (28,  100), (27,  200),
           -- campaign weapons: first gun at op 3
           (10,  300), (11,  600), (12,  900),
           -- Endless weapons: endgame, unlocked only after all 15 ops
           (29, 2000), (30, 2500), (13, 3500),
           (31, 4000), (32, 4500), (33, 5000)
       ) AS v(on_chain_id, price)
 WHERE p.item_id = i.id
   AND p.chain_id = 43114
   AND i.on_chain_id = v.on_chain_id;
