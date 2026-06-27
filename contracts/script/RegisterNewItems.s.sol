// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";

/// @notice Registers guns, ammo, and attachments on-chain (items 10-25).
/// @dev    forge script script/RegisterNewItems.s.sol --rpc-url $CELO_RPC_URL --broadcast
contract RegisterNewItems is Script {
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

        ItemDef[] memory defs = new ItemDef[](16);

        // Guns (10-13)
        defs[0]  = ItemDef({ id: 10, maxSupply: 0,  priceG: 150,  name: "Compact SMG" });
        defs[1]  = ItemDef({ id: 11, maxSupply: 0,  priceG: 400,  name: "Assault Rifle" });
        defs[2]  = ItemDef({ id: 12, maxSupply: 0,  priceG: 900,  name: "Marksman Rifle" });
        defs[3]  = ItemDef({ id: 13, maxSupply: 50, priceG: 2000, name: "Valor Prototype" });

        // Ammo (14-17)
        defs[4]  = ItemDef({ id: 14, maxSupply: 0, priceG: 80,  name: "Hollow Point Rounds" });
        defs[5]  = ItemDef({ id: 15, maxSupply: 0, priceG: 200, name: "Armor Piercing Rounds" });
        defs[6]  = ItemDef({ id: 16, maxSupply: 0, priceG: 100, name: "Tracer Rounds" });
        defs[7]  = ItemDef({ id: 17, maxSupply: 0, priceG: 500, name: "Incendiary Rounds" });

        // Attachments (18-25)
        defs[8]  = ItemDef({ id: 18, maxSupply: 0, priceG: 120, name: "Suppressor" });
        defs[9]  = ItemDef({ id: 19, maxSupply: 0, priceG: 250, name: "Extended Barrel" });
        defs[10] = ItemDef({ id: 20, maxSupply: 0, priceG: 100, name: "Red Dot Sight" });
        defs[11] = ItemDef({ id: 21, maxSupply: 0, priceG: 300, name: "ACOG Scope" });
        defs[12] = ItemDef({ id: 22, maxSupply: 0, priceG: 90,  name: "Foregrip" });
        defs[13] = ItemDef({ id: 23, maxSupply: 0, priceG: 220, name: "Quick Grip" });
        defs[14] = ItemDef({ id: 24, maxSupply: 0, priceG: 100, name: "Extended Magazine" });
        defs[15] = ItemDef({ id: 25, maxSupply: 0, priceG: 280, name: "Speed Loader" });

        vm.startBroadcast(deployerKey);

        for (uint256 i = 0; i < defs.length; i++) {
            valorItems.registerItem(defs[i].id, defs[i].maxSupply, "");
            marketplace.listItem(defs[i].id, defs[i].priceG * D);
            console.log("Registered + listed: %s (id=%d, %d G$)", defs[i].name, defs[i].id, defs[i].priceG);
        }

        vm.stopBroadcast();
        console.log("\n16 items registered on-chain.");
    }
}
