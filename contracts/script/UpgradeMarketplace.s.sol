// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorMarketplace.sol";

/// @notice Upgrades the ValorMarketplace UUPS proxy to the latest implementation.
///         Run after adding purchaseWithPermit to ValorMarketplace.sol.
///
/// Required env vars (contracts/.env or shell):
///   DEPLOYER_PRIVATE_KEY   — must be the proxy owner
///   MARKETPLACE_CONTRACT   — proxy address (0x95D167f569cf05C967C0432e3123baeac5D8d78D)
///   CELO_RPC_URL           — https://forno.celo.org
///
/// Run:
///   forge script script/UpgradeMarketplace.s.sol \
///     --rpc-url $CELO_RPC_URL \
///     --broadcast \
///     --verify
contract UpgradeMarketplace is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address proxy       = vm.envAddress("MARKETPLACE_CONTRACT");

        console.log("Proxy:    %s", proxy);
        console.log("Deployer: %s", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);

        // Deploy the new implementation
        ValorMarketplace newImpl = new ValorMarketplace();
        console.log("New impl: %s", address(newImpl));

        // Upgrade the proxy and run the resale reinitializer (sets the default 5% fee).
        // NOTE: initializeResale is reinitializer(2) — runs once. If this proxy was
        // already upgraded to a resale impl, pass "" instead to avoid a revert.
        ValorMarketplace(proxy).upgradeToAndCall(
            address(newImpl),
            abi.encodeCall(ValorMarketplace.initializeResale, ())
        );
        console.log("Upgraded + resale initialized");

        vm.stopBroadcast();
    }
}
