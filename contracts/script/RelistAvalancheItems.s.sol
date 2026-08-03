// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorMarketplace.sol";

/// @notice Re-prices the Avalanche catalogue to match the rescaled ladder.
///
/// @dev THE INVARIANT THIS SCRIPT EXISTS TO MAINTAIN
///      A buyer signs an EIP-2612 permit for the price the SERVER quotes; the
///      marketplace then charges the price the CONTRACT holds. If those disagree
///      by one wei, `permit()` rejects the signature and the purchase reverts —
///      after the player has already approved it, and reading to them as "the
///      shop is broken".
///
///      So these prices MUST equal apps/api/migrations/rescale_avalanche_prices.sql
///      exactly. Run both, then verify chain against database before trusting it.
///
/// @dev WHY THE PRICES MOVED
///      The first pass anchored everything on "one clear = 100 SCRP" without
///      checking what a player can actually earn. Campaign is finite: 15 ops,
///      once each, 1,500 SCRP for life. At the old prices that bought the 800
///      entry gun and nothing else, with every other weapon behind Endless —
///      which is gated on finishing all 15 ops, deliberately.
///
///      Campaign tier now fits inside 1,500 (first gun at op 3), and the Endless
///      tier is explicitly endgame. Ember Halo came down from 8,000 to 5,000:
///      320 waves was roughly eight hours of Endless in a game with one recorded
///      Endless session ever, and an unreachable item is decoration.
///
/// @dev `listItem` overwrites an existing listing, so this is safe to re-run.
///      It does not touch ValorItems — the items are already registered.
///
/// @dev RUN
///   forge script script/RelistAvalancheItems.s.sol --rpc-url avalanche            # dry run
///   forge script script/RelistAvalancheItems.s.sol --rpc-url avalanche --broadcast --slow
contract RelistAvalancheItems is Script {
    function run() external {
        uint256 key = vm.envUint("AVALANCHE_DEPLOYER_PRIVATE_KEY");
        ValorMarketplace mkt = ValorMarketplace(vm.envAddress("AVALANCHE_MARKETPLACE_CONTRACT"));

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");

        uint256[26] memory ids = [
            uint256(7), 8,                      // boosters
            14, 16, 15, 17,                     // ammo
            22, 24, 20, 18, 23, 19, 25, 21,     // attachments
            26, 28, 27,                         // gear
            10, 11, 12,                         // campaign weapons
            29, 30, 13, 31, 32, 33              // Endless weapons
        ];
        uint256[26] memory prices = [
            uint256(10), 25,
            25, 25, 50, 75,
            75, 75, 75, 100, 150, 175, 175, 200,
            75, 100, 200,
            300, 600, 900,
            2000, 2500, 3500, 4000, 4500, 5000
        ];

        vm.startBroadcast(key);
        for (uint256 i = 0; i < ids.length; i++) {
            mkt.listItem(ids[i], prices[i] * 1e18);
        }
        vm.stopBroadcast();

        console.log("Re-listed", ids.length, "items at the rescaled ladder");
        console.log("Campaign tier: first gun at op 3 (300 SCRP), full kit inside 1,500");
        console.log("Endless tier:  2,000 to 5,000 SCRP, 20 to 140 waves past the campaign");
        console.log("NOW RUN rescale_avalanche_prices.sql, or every SCRP purchase reverts.");
    }
}
