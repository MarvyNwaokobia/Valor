// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";

/// @notice Registers the five SEASONAL weapons on-chain (items 29-33) so they can
///         actually be bought. A purchase builds a G$ permit against the ON-CHAIN
///         listing, so an item that exists only in the database reverts at checkout.
///
/// @dev    forge script script/RegisterSeasonalWeapons.s.sol \
///           --rpc-url $CELO_RPC_URL --broadcast
///         Env: DEPLOYER_PRIVATE_KEY (must be the contracts' owner), ITEMS_CONTRACT,
///         MARKETPLACE_CONTRACT.
///
/// ⚠️ PRICES MUST MATCH the DB exactly. `items.price_g` and the on-chain listing are
///    two halves of the same permit — if they disagree, the signature is built for a
///    different amount than the contract expects and every purchase reverts. These
///    values mirror apps/api/migrations/add_seasonal_weapons.sql.
contract RegisterSeasonalWeapons is Script {
    uint256 constant D = 1e18; // G$ decimals

    struct ItemDef {
        uint256 id;
        uint256 maxSupply; // 0 = unlimited
        uint256 priceG;
        string  name;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address itemsAddr   = vm.envAddress("ITEMS_CONTRACT");
        address marketAddr  = vm.envAddress("MARKETPLACE_CONTRACT");

        ValorItems       valorItems  = ValorItems(itemsAddr);
        ValorMarketplace marketplace = ValorMarketplace(marketAddr);

        ItemDef[] memory defs = new ItemDef[](5);
        defs[0] = ItemDef({ id: 29, maxSupply: 0, priceG: 3000,  name: "Ashfall Carbine"   });
        defs[1] = ItemDef({ id: 30, maxSupply: 0, priceG: 4500,  name: "Warden's Repeater" });
        defs[2] = ItemDef({ id: 31, maxSupply: 0, priceG: 6500,  name: "Rift Lance"        });
        defs[3] = ItemDef({ id: 32, maxSupply: 0, priceG: 8000,  name: "Seraph"            });
        defs[4] = ItemDef({ id: 33, maxSupply: 0, priceG: 10000, name: "Ember Halo"        });

        vm.startBroadcast(deployerKey);

        for (uint256 i = 0; i < defs.length; i++) {
            valorItems.registerItem(defs[i].id, defs[i].maxSupply, "");
            marketplace.listItem(defs[i].id, defs[i].priceG * D);
            console.log("Registered + listed: %s (id=%d, %d G$)", defs[i].name, defs[i].id, defs[i].priceG);
        }

        vm.stopBroadcast();
    }
}
