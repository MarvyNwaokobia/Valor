// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";

/// @notice Run this AFTER Deploy.s.sol to register and list all items.
/// @dev    forge script script/Setup.s.sol --rpc-url $CELO_RPC_URL --broadcast
///
/// Required env vars (set in contracts/.env):
///   DEPLOYER_PRIVATE_KEY  — wallet that owns ValorItems + ValorMarketplace
///   ITEMS_CONTRACT        — ValorItems address from Deploy output
///   MARKETPLACE_CONTRACT  — ValorMarketplace address from Deploy output
contract Setup is Script {
    // G$ has 18 decimals on Celo mainnet
    uint256 constant DECIMALS = 1e18;

    struct ItemDef {
        uint256 onChainId;
        uint256 maxSupply;   // 0 = unlimited
        uint256 priceG;      // in whole G$ (will be multiplied by DECIMALS)
        string  name;
    }

    function run() external {
        uint256 deployerKey  = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address itemsAddr    = vm.envAddress("ITEMS_CONTRACT");
        address marketAddr   = vm.envAddress("MARKETPLACE_CONTRACT");

        ValorItems        valorItems  = ValorItems(itemsAddr);
        ValorMarketplace  marketplace = ValorMarketplace(marketAddr);

        // ── Item definitions — must match Supabase seed (on_chain_id 1-9) ──────
        ItemDef[] memory items = new ItemDef[](9);
        items[0] = ItemDef({ onChainId: 1, maxSupply: 0,  priceG: 5,   name: "Iron Sword"    });
        items[1] = ItemDef({ onChainId: 2, maxSupply: 0,  priceG: 15,  name: "Steel Blade"   });
        items[2] = ItemDef({ onChainId: 3, maxSupply: 0,  priceG: 35,  name: "Void Edge"     });
        items[3] = ItemDef({ onChainId: 4, maxSupply: 0,  priceG: 5,   name: "Iron Shield"   });
        items[4] = ItemDef({ onChainId: 5, maxSupply: 0,  priceG: 20,  name: "Valor Guard"   });
        items[5] = ItemDef({ onChainId: 6, maxSupply: 0,  priceG: 40,  name: "Fortress Wall" });
        items[6] = ItemDef({ onChainId: 7, maxSupply: 0,  priceG: 10,  name: "XP Booster"    });
        items[7] = ItemDef({ onChainId: 8, maxSupply: 0,  priceG: 25,  name: "Elite Booster" });
        items[8] = ItemDef({ onChainId: 9, maxSupply: 50, priceG: 100, name: "The Last Blade" });

        vm.startBroadcast(deployerKey);

        for (uint256 i = 0; i < items.length; i++) {
            ItemDef memory item = items[i];

            // Register item NFT supply in ValorItems
            valorItems.registerItem(
                item.onChainId,
                item.maxSupply,
                "" // metadata URI — leave empty for now, set later
            );

            // List item for sale in ValorMarketplace
            marketplace.listItem(
                item.onChainId,
                item.priceG * DECIMALS
            );

            console.log("Registered + listed: %s (id=%d, price=%d G$)",
                item.name, item.onChainId, item.priceG);
        }

        vm.stopBroadcast();

        console.log("\nAll 9 items registered and listed.");
        console.log("ValorItems:       %s", itemsAddr);
        console.log("ValorMarketplace: %s", marketAddr);
    }
}
