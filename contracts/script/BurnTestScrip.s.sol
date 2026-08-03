// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Scrip.sol";

/// @notice Burns the deploy-time test SCRP held by the original Avalanche deployer.
///
/// @dev THE PROBLEM
///      Deploying and wiring Scrip on 2 Aug 2026 involved four test mints totalling
///      1,125 SCRP into 0x9283f1…, the wallet that ran DeployAvalanche.s.sol. Total
///      supply is 1,225, so that wallet holds 92% of every SCRP in existence and
///      exactly one real player holds the other 100.
///
///      Nothing is wrong with the token. What is wrong is what the holder list SAYS:
///      anyone who opens Scrip on Snowtrace and clicks "Holders" sees a project whose
///      team holds almost all the supply. For a grant reviewer that is a five-second
///      impression and a hard one to talk back from, and it costs one transaction to
///      remove.
///
/// @dev WHICH KEY THIS NEEDS, AND WHY IT IS NOT THE USUAL ONE
///      SCRIP_BURN_PRIVATE_KEY, which must be the key for 0x9283f1…
///
///      Not AVALANCHE_DEPLOYER_PRIVATE_KEY. That name now resolves to the RELAY
///      (0x25496AC7…) because RotateAvalancheRelay.s.sol handed everything over to it
///      and the env was repointed. The relay holds 0 SCRP, so running this with the
///      usual key would burn nothing and look like it worked.
///
///      ERC20Burnable only lets an account burn its OWN balance (or one it has an
///      allowance for), so there is no way to do this from anywhere else. If the key
///      for 0x9283f1… is genuinely lost, the alternative is MigrateScrip.s.sol, which
///      abandons this token entirely and makes the stranded balance irrelevant.
///
/// @dev GAS
///      0x9283f1… held ~0.003 AVAX at last check, which covers a ~35k-gas burn at
///      normal C-Chain base fees but leaves no headroom if the fee spikes. If the
///      broadcast fails on funds, send it 0.01 AVAX and re-run.
///
/// @dev RUN
///   Dry run first. It prints the balance it is about to destroy:
///     forge script script/BurnTestScrip.s.sol --rpc-url $AVALANCHE_RPC_URL
///   Then:
///     forge script script/BurnTestScrip.s.sol --rpc-url $AVALANCHE_RPC_URL --broadcast
contract BurnTestScrip is Script {
    function run() external {
        uint256 burnerKey = vm.envUint("SCRIP_BURN_PRIVATE_KEY");
        address burner    = vm.addr(burnerKey);
        address scripAddr = vm.envAddress("SCRIP_CONTRACT");

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");
        require(scripAddr.code.length > 0, "SCRIP_CONTRACT has no code");

        Scrip scrip = Scrip(scripAddr);
        uint256 balance = scrip.balanceOf(burner);
        uint256 supplyBefore = scrip.totalSupply();

        console.log("Burner:            ", burner);
        console.log("Its SCRP balance:  ", balance);
        console.log("Total supply now:  ", supplyBefore);

        // A zero balance almost certainly means the wrong key is in the env rather
        // than a job already done, so fail loudly instead of broadcasting a no-op.
        require(balance > 0, "that wallet holds no SCRP - wrong key? expected 0x9283f1...");
        require(burner != scrip.owner(), "refusing to burn from the owner wallet - check the key");

        vm.startBroadcast(burnerKey);
        scrip.burn(balance);
        vm.stopBroadcast();

        console.log("");
        console.log("=== burned ===");
        console.log("Destroyed:          ", balance);
        console.log("Total supply after: ", scrip.totalSupply());
        console.log("Remaining supply is player-held. Check Snowtrace 'Holders'.");
    }
}
