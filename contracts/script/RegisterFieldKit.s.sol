// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";

/// @notice Registers the Field Kit gear on-chain (items 26-28), so buying it in
///         the Marketplace charges real G$ via the marketplace contract.
/// @dev    forge script script/RegisterFieldKit.s.sol \
///           --rpc-url $CELO_RPC_URL --broadcast
///         Env: DEPLOYER_PRIVATE_KEY, ITEMS_CONTRACT, MARKETPLACE_CONTRACT.
///         IDs match supabase/migrations/009_field_kit.sql (on_chain_id 26/27/28).
contract RegisterFieldKit is Script {
    uint256 constant D = 1e18; // G$ decimals

    struct ItemDef {
        uint256 id;
        uint256 maxSupply;
        uint256 priceG;
        string  name;
    }

    function run() external {
        uint256 deployerKey  = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address itemsAddr    = vm.envAddress("ITEMS_CONTRACT");
        address marketAddr   = vm.envAddress("MARKETPLACE_CONTRACT");

        ValorItems       valorItems  = ValorItems(itemsAddr);
        ValorMarketplace marketplace = ValorMarketplace(marketAddr);

        ItemDef[] memory defs = new ItemDef[](3);
        // Field Kit (26-28) — maxSupply 0 = unlimited. Prices match the migration.
        defs[0] = ItemDef({ id: 26, maxSupply: 0, priceG: 90,  name: "Tactical Flashlight" });
        defs[1] = ItemDef({ id: 27, maxSupply: 0, priceG: 350, name: "Night Vision Goggles" });
        defs[2] = ItemDef({ id: 28, maxSupply: 0, priceG: 140, name: "Laser Sight" });

        vm.startBroadcast(deployerKey);

        for (uint256 i = 0; i < defs.length; i++) {
            valorItems.registerItem(defs[i].id, defs[i].maxSupply, "");
            marketplace.listItem(defs[i].id, defs[i].priceG * D);
            console.log("Registered + listed: %s (id=%d, %d G$)", defs[i].name, defs[i].id, defs[i].priceG);
        }

        vm.stopBroadcast();
        console.log("\nField Kit registered on-chain (items 26-28).");
    }
}
