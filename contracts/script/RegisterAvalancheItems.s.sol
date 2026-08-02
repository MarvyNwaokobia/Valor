// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";

/// @notice Registers and lists Valor's catalogue on Avalanche C-Chain, priced in SCRP.
///
/// @dev PRICES ARE NOT THE CELO PRICES, ON PURPOSE
///      Celo's catalogue is priced in G$, which has a real exchange rate. SCRP has
///      none by design, so its only meaning is TIME PLAYED. Copying the G$ numbers
///      across would import a bug: on Celo one campaign win pays 1,000 G$ and the
///      most expensive gun costs 1,800, so two missions buy the best item in the
///      game. That is why the Celo shop has taken in 73,620 G$ against 1,154,136
///      paid out, roughly 16 to 1 outbound. The shop is not a sink there.
///
///      So these are priced against a single anchor:
///
///          ONE CAMPAIGN WIN = 100 SCRP
///
///      and every price below is a multiple of that, i.e. "how many missions".
///      At roughly four minutes a mission:
///
///          booster       25      quarter of a mission
///          ammo          50-250  half a mission to two and a half
///          attachment   200-450  two to four missions
///          gear         200-500
///          entry gun        800  eight missions, ~30 min, first-session goal
///          top gun        8,000  eighty missions, ~5 hours, aspirational
///
///      The shape that matters is having something to want after 30 minutes AND
///      something to want after five hours. Celo currently has neither.
///
/// @dev THIS ALONE DOES NOT MAKE THE ECONOMY WORK
///      Every item here is a ONE-TIME purchase. Once a player owns the catalogue
///      they stop spending forever and never stop earning, so their balance grows
///      and stops meaning anything. Repeatable sinks are what keep an economy
///      alive: duel stakes (value moves player to player, house takes a cut),
///      mid-run revives, and consumables that are actually consumed. Treat this
///      script as the floor, not the economy.
///
/// @dev THE INVARIANT
///      The DB price for a given (item, chain) MUST equal the on-chain listing
///      price, or a purchase builds a permit for one amount against a listing for
///      another and reverts. These prices are mirrored in
///      apps/api/migrations/add_avalanche_item_prices.sql and must be changed
///      together.
///
/// @dev RUN
///   forge script script/RegisterAvalancheItems.s.sol --rpc-url avalanche            # dry run
///   forge script script/RegisterAvalancheItems.s.sol --rpc-url avalanche --broadcast
contract RegisterAvalancheItems is Script {
    struct Listing {
        uint256 id;      // on_chain_id, matching the Celo registry so one DB row serves both
        uint256 price;   // whole SCRP; scaled to 18 decimals below
        string  uri;
    }

    function run() external {
        uint256 key = vm.envUint("AVALANCHE_DEPLOYER_PRIVATE_KEY");
        ValorItems items = ValorItems(vm.envAddress("AVALANCHE_ITEMS_CONTRACT"));
        ValorMarketplace mkt = ValorMarketplace(vm.envAddress("AVALANCHE_MARKETPLACE_CONTRACT"));

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");

        // 26 entries: 2 boosters, 4 ammo, 8 attachments, 3 gear, 9 weapons.
        Listing[26] memory L = [
            // ── Boosters: cheap enough to buy several a session ───────────────
            Listing(7,   25, "ipfs://xp-booster"),
            Listing(8,   50, "ipfs://elite-booster"),
            // ── Ammo: consumable, the most repeatable sink in the catalogue ───
            Listing(14,  50, "ipfs://hollow-point"),
            Listing(16,  50, "ipfs://tracer"),
            Listing(15, 125, "ipfs://armor-piercing"),
            Listing(17, 250, "ipfs://incendiary"),
            // ── Attachments: 2-4 missions ─────────────────────────────────────
            Listing(22, 200, "ipfs://foregrip"),
            Listing(24, 200, "ipfs://extended-magazine"),
            Listing(20, 200, "ipfs://red-dot-sight"),
            Listing(18, 250, "ipfs://suppressor"),
            Listing(23, 350, "ipfs://quick-grip"),
            Listing(19, 400, "ipfs://extended-barrel"),
            Listing(25, 400, "ipfs://speed-loader"),
            Listing(21, 450, "ipfs://acog-scope"),
            // ── Gear ──────────────────────────────────────────────────────────
            Listing(26, 200, "ipfs://tactical-flashlight"),
            Listing(28, 250, "ipfs://laser-sight"),
            Listing(27, 500, "ipfs://night-vision"),
            // ── Weapons: the progression spine, 8 missions to 80 ──────────────
            Listing(10,  800, "ipfs://compact-smg"),
            Listing(11, 1500, "ipfs://assault-rifle"),
            Listing(12, 2500, "ipfs://marksman-rifle"),
            Listing(29, 2500, "ipfs://ashfall-carbine"),
            Listing(30, 3000, "ipfs://wardens-repeater"),
            Listing(13, 6000, "ipfs://valor-prototype"),
            Listing(31, 6500, "ipfs://rift-lance"),
            Listing(32, 7000, "ipfs://seraph"),
            Listing(33, 8000, "ipfs://ember-halo")
        ];

        vm.startBroadcast(key);
        for (uint256 i = 0; i < L.length; i++) {
            // maxSupply 0 = unlimited, matching the Celo registry. These are shop
            // goods, not collectibles; scarcity here would only gate progression.
            items.registerItem(L[i].id, 0, L[i].uri);
            mkt.listItem(L[i].id, L[i].price * 1e18);
        }
        vm.stopBroadcast();

        console.log("Registered and listed", L.length, "items on Avalanche C-Chain");
        console.log("Anchor: one campaign win = 100 SCRP");
        console.log("REMINDER: run add_avalanche_item_prices.sql so the DB agrees, or purchases revert.");
    }
}
