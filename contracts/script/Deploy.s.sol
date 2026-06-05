// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";
import "../src/ValorRewardPool.sol";

/// @notice Deploys ValorItems, ValorMarketplace, and ValorRewardPool.
/// @dev    Run with:
///   # Celo mainnet
///   forge script script/Deploy.s.sol --rpc-url $CELO_RPC_URL --broadcast --verify
///
///   # Alfajores testnet
///   forge script script/Deploy.s.sol --rpc-url $CELO_TESTNET_RPC_URL --broadcast
///
/// Required env vars (set in contracts/.env):
///   DEPLOYER_PRIVATE_KEY  — deployer wallet (needs CELO for gas)
///   BACKEND_SIGNER_ADDRESS — backend wallet address (for reward pool)
///   G_TOKEN_ADDRESS        — G$ contract address:
///                            mainnet: 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A
///                            alfajores staging: 0x61FA0fB802fd8345C06da558240E0651886fec69
contract Deploy is Script {
    function run() external {
        uint256 deployerKey  = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer     = vm.addr(deployerKey);
        address backend      = vm.envAddress("BACKEND_SIGNER_ADDRESS");

        // G$ token — defaults to Celo mainnet if env var not set
        address gToken = vm.envOr(
            "G_TOKEN_ADDRESS",
            address(0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A)
        );

        console.log("Deployer:         %s", deployer);
        console.log("Backend signer:   %s", backend);
        console.log("G$ token:         %s", gToken);

        vm.startBroadcast(deployerKey);

        // 1. Deploy ValorItems (ERC1155 NFT)
        ValorItems valorItems = new ValorItems(deployer);
        console.log("ValorItems:       %s", address(valorItems));

        // 2. Deploy ValorMarketplace (transferAndCall receiver)
        ValorMarketplace marketplace = new ValorMarketplace(gToken, address(valorItems), deployer);
        console.log("ValorMarketplace: %s", address(marketplace));

        // 3. Deploy ValorRewardPool (G$ streaming for rank rewards)
        ValorRewardPool rewardPool = new ValorRewardPool(gToken, backend, deployer);
        console.log("ValorRewardPool:  %s", address(rewardPool));

        // 4. Authorise marketplace to mint items
        valorItems.setMarketplace(address(marketplace));

        vm.stopBroadcast();

        console.log("\n--- Add to contracts/.env and apps/web/.env.local ---");
        console.log("ITEMS_CONTRACT=%s",       address(valorItems));
        console.log("MARKETPLACE_CONTRACT=%s", address(marketplace));
        console.log("REWARD_POOL_CONTRACT=%s",  address(rewardPool));
        console.log("\nThen run: forge script script/Setup.s.sol --rpc-url <rpc> --broadcast");
    }
}
