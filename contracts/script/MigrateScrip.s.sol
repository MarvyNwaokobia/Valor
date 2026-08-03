// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/Scrip.sol";
import "../src/ValorMarketplace.sol";

/// @notice Replaces the original non-upgradeable Scrip with a UUPS proxy, and moves
///         every real holder across.
///
/// @dev WHY A NEW ADDRESS IS UNAVOIDABLE
///      The first Scrip was deployed as a plain contract on 2 Aug 2026. There is no
///      way to put existing bytecode behind a proxy after the fact: a proxy has to be
///      deployed in front of an implementation from the start. Making Scrip
///      upgradeable therefore means a NEW TOKEN AT A NEW ADDRESS, and everything
///      holding or naming the old one has to be repointed.
///
/// @dev THIS IS THE CHEAPEST MOMENT THIS WILL EVER BE
///      Total supply is 1,225 SCRP. 1,125 of that is deploy-time test minting that
///      was going to be burned anyway, and exactly ONE real player holds the other
///      100. Migration is: mint 100 SCRP to one address. Every day this waits, that
///      list gets longer.
///
///      A pleasant side effect: the old token's 92%-held supply stops mattering,
///      because nothing points at it any more. The burn on the old contract becomes
///      optional tidying rather than a blocker.
///
/// @dev WHAT THIS SCRIPT DOES AND DOES NOT DO
///      Does:     deploy the new Scrip proxy, set the relay as minter, re-mint to the
///                holders listed in HOLDERS below, repoint the marketplace.
///      Does not: touch the old contract, migrate automatically, or guess who holds
///                what. The holder list is written by hand and checked against chain
///                before running, because minting from a list is exactly the kind of
///                operation that should not be driven by a loop over an event scan
///                nobody read.
///
/// @dev BEFORE RUNNING
///      1. Re-read holders off chain and update HOLDERS/AMOUNTS below:
///           cast call $SCRIP_CONTRACT "balanceOf(address)(uint256)" <holder> \
///             --rpc-url $AVALANCHE_RPC_URL
///      2. Withdraw any marketplace revenue. `setCurrency` refuses to run while
///         `accumulatedRevenue` is non-zero, because that figure would be left
///         denominated in the old token.
///      3. Dry-run without --broadcast and read every address it prints.
///
/// @dev AFTER RUNNING
///      Update, in this order, and do not skip any:
///        • contracts/.env            SCRIP_CONTRACT
///        • API env                   SCRIP_CONTRACT  (then redeploy the backend)
///        • editions/avalanche/config.ts  currency.address
///      A stale address anywhere produces a permit signed against a token the
///      marketplace no longer accepts, which reverts after the player has signed.
///
/// @dev RUN
///   forge script script/MigrateScrip.s.sol --rpc-url $AVALANCHE_RPC_URL --broadcast --verify
contract MigrateScrip is Script {
    /// Real holders of the OLD Scrip, as of 3 Aug 2026. Verified on chain.
    ///
    /// Deliberately excludes 0x9283f1…, the original deployer, whose 1,125 SCRP is
    /// deploy-time test minting and is NOT player money. Re-minting it would carry
    /// the exact problem this migration is a chance to leave behind.
    function _holders() internal pure returns (address[] memory h, uint256[] memory a) {
        h = new address[](1);
        a = new uint256[](1);
        h[0] = 0x7Ab0d0463FAC8ca43c6b841Daf692f67cf13bB9E;
        a[0] = 100e18;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("AVALANCHE_DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address backend     = vm.envAddress("AVALANCHE_BACKEND_SIGNER_ADDRESS");
        address safe        = vm.envAddress("VALOR_OWNER_SAFE");
        address oldScrip    = vm.envAddress("SCRIP_CONTRACT");
        address marketplace = vm.envAddress("AVALANCHE_MARKETPLACE_CONTRACT");

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");
        require(safe != address(0) && safe.code.length > 0, "VALOR_OWNER_SAFE must be a Safe");
        require(safe != backend, "the Safe must not be the relay");
        require(deployer.balance > 0, "deployer has no AVAX");

        (address[] memory holders, uint256[] memory amounts) = _holders();

        // Check the hand-written list against the chain BEFORE minting anything. A
        // list that has drifted since it was written is the failure mode here, and
        // it is silent: everyone gets the wrong balance and nobody notices until
        // someone complains.
        for (uint256 i; i < holders.length; i++) {
            uint256 actual = IERC20(oldScrip).balanceOf(holders[i]);
            require(actual == amounts[i], "HOLDERS is stale: re-read balances off chain");
        }

        console.log("Old Scrip: ", oldScrip);
        console.log("Deployer:  ", deployer);
        console.log("Safe:      ", safe);
        console.log("Relay:     ", backend);
        console.log("Holders to re-mint:", holders.length);

        vm.startBroadcast(deployerKey);

        // Owned by the DEPLOYER initially, not the Safe: the steps below need owner
        // rights (setMinter, and the marketplace repoint). Ownership goes to the Safe
        // at the end, and HandOverToSafe.s.sol is the check that it actually did.
        Scrip impl = new Scrip();
        Scrip scrip = Scrip(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Scrip.initialize, (deployer))
        )));

        // Deployer mints the migration balances, then drops the right to mint. Only
        // the relay keeps it, which is the same shape the original deploy had.
        scrip.setMinter(deployer, true);
        for (uint256 i; i < holders.length; i++) {
            scrip.mint(holders[i], amounts[i]);
        }
        scrip.setMinter(deployer, false);
        scrip.setMinter(backend, true);

        // Repoint the shop. Reverts if revenue is outstanding; withdraw it first.
        ValorMarketplace(marketplace).setCurrency(address(scrip));

        // And hand the token to the Safe. An upgradeable token whose upgrade key
        // lives on a server is worse than the immutable one it replaced, so this
        // step is not optional and is not left for later.
        scrip.transferOwnership(safe);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Scrip migrated ===");
        console.log("NEW Scrip (proxy, USE THIS):", address(scrip));
        console.log("NEW Scrip (implementation): ", address(impl));
        console.log("New owner:", scrip.owner());
        console.log("New total supply:", scrip.totalSupply());
        console.log("");
        console.log("NOW UPDATE ALL THREE, or purchases will revert:");
        console.log("  contracts/.env               SCRIP_CONTRACT");
        console.log("  API env                      SCRIP_CONTRACT (redeploy backend)");
        console.log("  editions/avalanche/config.ts currency.address");
    }
}
