// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorRewardPool.sol";

/// @notice Upgrades the ValorRewardPool UUPS proxy to the latest implementation.
///         Run after adding distributeReward() (the generic one-time bounty payout,
///         B0). The change is append-only storage + a new function, so NO
///         reinitializer is needed — upgradeToAndCall with empty data.
///
/// Required env vars (contracts/.env or shell):
///   DEPLOYER_PRIVATE_KEY   — must be the proxy owner
///   REWARD_POOL_CONTRACT   — proxy address (same value the API uses)
///   CELO_RPC_URL           — https://forno.celo.org
///
/// Run:
///   forge script script/UpgradeRewardPool.s.sol \
///     --rpc-url $CELO_RPC_URL \
///     --broadcast \
///     --verify
contract UpgradeRewardPool is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address proxy       = vm.envAddress("REWARD_POOL_CONTRACT");

        console.log("Proxy:    %s", proxy);
        console.log("Deployer: %s", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);

        ValorRewardPool newImpl = new ValorRewardPool();
        console.log("New impl: %s", address(newImpl));

        // No new initializer state — just point the proxy at the new code.
        ValorRewardPool(proxy).upgradeToAndCall(address(newImpl), "");
        console.log("Upgraded ValorRewardPool");

        vm.stopBroadcast();
    }
}
