// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/ValorRewardPool.sol";

/// @notice Deploys a SECOND ValorRewardPool (UUPS upgradeable, via ERC1967Proxy) to be
///         the dedicated Endless payout pool. Identical contract to the main reward
///         pool — same backend signer so the API can call distributeReward on it — but
///         a separate balance, so Endless spending can't starve rank-up / bounty G$.
///
/// After deploy: set ENDLESS_REWARD_POOL_CONTRACT (Render) to the printed PROXY address,
/// then fund that proxy address with G$.
///
/// Env: DEPLOYER_PRIVATE_KEY, BACKEND_SIGNER_ADDRESS, (optional) G_TOKEN_ADDRESS.
contract DeployEndlessPool is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address backend     = vm.envAddress("BACKEND_SIGNER_ADDRESS");
        address gToken      = vm.envOr(
            "G_TOKEN_ADDRESS",
            address(0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A)
        );

        console.log("Deployer:       %s", deployer);
        console.log("Backend signer: %s", backend);
        console.log("G$ token:       %s", gToken);

        vm.startBroadcast(deployerKey);

        ValorRewardPool impl = new ValorRewardPool();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ValorRewardPool.initialize, (gToken, backend, deployer))
        );

        vm.stopBroadcast();

        console.log("Endless pool impl:  %s", address(impl));
        console.log("Endless pool PROXY: %s", address(proxy));
        console.log(">>> Set ENDLESS_REWARD_POOL_CONTRACT to the PROXY, then fund the PROXY with G$.");
    }
}
