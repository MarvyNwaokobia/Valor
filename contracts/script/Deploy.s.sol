// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";
import "../src/ValorRewardPool.sol";
import "../src/ValorGameRecord.sol";

/// @notice Deploys ValorItems, ValorMarketplace, ValorRewardPool, and ValorGameRecord
///         as UUPS upgradeable proxies via ERC1967Proxy.
/// @dev    Run with:
///   # Celo mainnet
///   forge script script/Deploy.s.sol --rpc-url $CELO_RPC_URL --broadcast --verify
///
///   # Alfajores testnet
///   forge script script/Deploy.s.sol --rpc-url $CELO_TESTNET_RPC_URL --broadcast
///
/// Required env vars (set in contracts/.env):
///   DEPLOYER_PRIVATE_KEY  — deployer wallet (needs CELO for gas)
///   BACKEND_SIGNER_ADDRESS — backend wallet address (for reward pool + game record)
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

        // 1. ValorItems — deploy impl + proxy
        ValorItems itemsImpl = new ValorItems();
        ERC1967Proxy itemsProxy = new ERC1967Proxy(
            address(itemsImpl),
            abi.encodeCall(ValorItems.initialize, (deployer))
        );
        ValorItems valorItems = ValorItems(address(itemsProxy));
        console.log("ValorItems impl:  %s", address(itemsImpl));
        console.log("ValorItems proxy: %s", address(valorItems));

        // 2. ValorMarketplace — deploy impl + proxy
        ValorMarketplace marketplaceImpl = new ValorMarketplace();
        ERC1967Proxy marketplaceProxy = new ERC1967Proxy(
            address(marketplaceImpl),
            abi.encodeCall(ValorMarketplace.initialize, (gToken, address(valorItems), deployer))
        );
        ValorMarketplace marketplace = ValorMarketplace(address(marketplaceProxy));
        console.log("ValorMarketplace impl:  %s", address(marketplaceImpl));
        console.log("ValorMarketplace proxy: %s", address(marketplace));

        // 3. ValorRewardPool — deploy impl + proxy
        ValorRewardPool rewardPoolImpl = new ValorRewardPool();
        ERC1967Proxy rewardPoolProxy = new ERC1967Proxy(
            address(rewardPoolImpl),
            abi.encodeCall(ValorRewardPool.initialize, (gToken, backend, deployer))
        );
        ValorRewardPool rewardPool = ValorRewardPool(address(rewardPoolProxy));
        console.log("ValorRewardPool impl:  %s", address(rewardPoolImpl));
        console.log("ValorRewardPool proxy: %s", address(rewardPool));

        // 4. ValorGameRecord — deploy impl + proxy
        ValorGameRecord gameRecordImpl = new ValorGameRecord();
        ERC1967Proxy gameRecordProxy = new ERC1967Proxy(
            address(gameRecordImpl),
            abi.encodeCall(ValorGameRecord.initialize, (backend, deployer))
        );
        ValorGameRecord gameRecord = ValorGameRecord(address(gameRecordProxy));
        console.log("ValorGameRecord impl:  %s", address(gameRecordImpl));
        console.log("ValorGameRecord proxy: %s", address(gameRecord));

        // 5. Authorise marketplace to mint items
        valorItems.setMarketplace(address(marketplace));

        vm.stopBroadcast();

        console.log("\n--- Copy proxy addresses into contracts/.env and apps/web/.env.local ---");
        console.log("ITEMS_CONTRACT=%s",       address(valorItems));
        console.log("MARKETPLACE_CONTRACT=%s", address(marketplace));
        console.log("REWARD_POOL_CONTRACT=%s",  address(rewardPool));
        console.log("GAME_RECORD_CONTRACT=%s",  address(gameRecord));
        console.log("\nThen run: forge script script/Setup.s.sol --rpc-url <rpc> --broadcast");
    }
}
