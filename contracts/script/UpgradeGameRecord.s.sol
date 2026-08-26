// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValorGameRecord.sol";

/// @notice Upgrades the ValorGameRecord UUPS proxy to the latest implementation.
///         Run after adding recordVerification() (a distinct on-chain event for
///         GoodDollar verification, separate from BattleRecorded so verifying
///         does not get miscounted as "played"). Append-only storage + a new
///         function, so NO reinitializer is needed — upgradeToAndCall with
///         empty data.
///
/// Required env vars (contracts/.env or shell):
///   DEPLOYER_PRIVATE_KEY   — must be the proxy owner
///   GAME_RECORD_CONTRACT   — proxy address (same value the API uses)
///   CELO_RPC_URL           — https://forno.celo.org
///
/// Run:
///   forge script script/UpgradeGameRecord.s.sol \
///     --rpc-url $CELO_RPC_URL \
///     --broadcast \
///     --verify
contract UpgradeGameRecord is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address proxy       = vm.envAddress("GAME_RECORD_CONTRACT");

        console.log("Proxy:    %s", proxy);
        console.log("Deployer: %s", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);

        ValorGameRecord newImpl = new ValorGameRecord();
        console.log("New impl: %s", address(newImpl));

        // No new initializer state — just point the proxy at the new code.
        ValorGameRecord(proxy).upgradeToAndCall(address(newImpl), "");
        console.log("Upgraded ValorGameRecord");

        vm.stopBroadcast();
    }
}
