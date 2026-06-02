// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";
import "../src/ValorRewardPool.sol";

contract Deploy is Script {
    // G$ on Celo mainnet
    address constant G_TOKEN = 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address backend = vm.envAddress("BACKEND_SIGNER_ADDRESS");

        vm.startBroadcast(deployerKey);

        // 1. Deploy ValorItems
        ValorItems valorItems = new ValorItems(deployer);
        console.log("ValorItems:", address(valorItems));

        // 2. Deploy ValorMarketplace
        ValorMarketplace marketplace = new ValorMarketplace(G_TOKEN, address(valorItems), deployer);
        console.log("ValorMarketplace:", address(marketplace));

        // 3. Deploy ValorRewardPool
        ValorRewardPool rewardPool = new ValorRewardPool(G_TOKEN, backend, deployer);
        console.log("ValorRewardPool:", address(rewardPool));

        // 4. Wire up: allow marketplace to mint items
        valorItems.setMarketplace(address(marketplace));

        vm.stopBroadcast();

        // Output for .env
        console.log("\n--- Add to .env ---");
        console.log("ITEMS_CONTRACT=%s", address(valorItems));
        console.log("MARKETPLACE_CONTRACT=%s", address(marketplace));
        console.log("REWARD_POOL_CONTRACT=%s", address(rewardPool));
    }
}
