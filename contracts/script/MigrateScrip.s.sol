// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/Scrip.sol";
import "../src/ValorDuel.sol";
import "../src/ValorMarketplace.sol";

/// @notice Replaces the original non-upgradeable Scrip with a UUPS proxy, moves
///         every holder across, and repoints the contracts that name it.
///
/// @dev WHY A NEW ADDRESS IS UNAVOIDABLE
///      The first Scrip was deployed as a plain contract on 2 Aug 2026. Existing
///      bytecode cannot be put behind a proxy after the fact, so making it
///      upgradeable means a NEW TOKEN AT A NEW ADDRESS and repointing everything
///      that referenced the old one.
///
/// @dev THIS IS NO LONGER THE ONE-HOLDER JOB IT WAS
///      When this script was first written, supply was 1,225 SCRP with a single
///      real holder. Delivering the campaign backfill changed that within hours:
///      60 holders, 34,150 SCRP. The holder list is therefore NOT hardcoded any
///      more — it is rebuilt from Transfer events and read from
///      `scrip-holders.json`, and the script refuses to run if that file does not
///      reconcile against the live totalSupply. A stale list here would silently
///      short-change real players.
///
///      Regenerate the file immediately before running. Every claim between
///      generating it and broadcasting is a balance this would miss.
///
/// @dev WHY ValorDuel IS REDEPLOYED TOO
///      `ValorDuel.scrip` is set once at initialize and has no setter, on purpose:
///      an escrow that can swap the asset it is holding mid-duel is not an escrow.
///      That decision means a new token needs a new escrow. This is free right
///      now and will not stay free — the live escrow holds nothing and has settled
///      zero duels. Once real stakes are in it, this migration stops being
///      possible without stranding them.
///
/// @dev WHAT THIS SCRIPT CANNOT DO
///      `ValorMarketplace.setCurrency` is `onlyOwner`, and the marketplace is now
///      owned by the Safe. The script prints the calldata for that call; a signer
///      has to execute it through the Safe. Until they do, the shop still charges
///      in OLD Scrip, which is the correct failure mode: the old token keeps
///      working right up until the switch, so there is no window where nobody can
///      buy anything.
///
/// @dev ORDER, AND WHY OLD SUPPLY IS LEFT ALONE
///      The old token is abandoned rather than burned. Burning would need every
///      holder's signature, which is not available. Abandoned is fine once nothing
///      references it, and the new token's supply is the honest one.
///
/// @dev RUN
///   1. Regenerate the holder list (see the python in the session notes / README)
///   2. forge script script/MigrateScrip.s.sol --rpc-url $AVALANCHE_RPC_URL
///   3. forge script script/MigrateScrip.s.sol --rpc-url $AVALANCHE_RPC_URL --broadcast --verify
///   4. Execute the printed setCurrency call through the Safe
///   5. Update SCRIP_CONTRACT + AVALANCHE_DUEL_CONTRACT in contracts/.env, the API
///      env (Railway), and editions/avalanche/config.ts
contract MigrateScrip is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("AVALANCHE_DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address backend     = vm.envAddress("AVALANCHE_BACKEND_SIGNER_ADDRESS");
        address safe        = vm.envAddress("VALOR_OWNER_SAFE");
        address oldScrip    = vm.envAddress("SCRIP_CONTRACT");
        address marketplace = vm.envAddress("AVALANCHE_MARKETPLACE_CONTRACT");
        uint16  cutBps      = uint16(vm.envOr("DUEL_HOUSE_CUT_BPS", uint256(50)));

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");
        require(safe != address(0) && safe.code.length > 0, "VALOR_OWNER_SAFE must be a Safe");
        require(safe != backend, "the Safe must not be the relay");
        require(deployer.balance > 0, "deployer has no AVAX");

        string memory raw = vm.readFile("scrip-holders.json");
        address[] memory holders = vm.parseJsonAddressArray(raw, ".addrs");
        uint256[] memory amounts = vm.parseJsonUintArray(raw, ".amounts");
        require(holders.length == amounts.length, "holder list is malformed");
        require(holders.length > 0, "holder list is empty");

        // The guard that makes this safe to run. If the file does not account for
        // every SCRP in existence, someone is about to be short-changed, and the
        // only moment that is cheap to notice is before broadcasting.
        uint256 listed;
        for (uint256 i; i < amounts.length; i++) listed += amounts[i];
        uint256 supply = IERC20(oldScrip).totalSupply();
        require(
            listed == supply,
            "scrip-holders.json does not reconcile against totalSupply - regenerate it"
        );

        console.log("Migrating Scrip to a proxy.");
        console.log("  old token: ", oldScrip);
        console.log("  holders:   ", holders.length);
        console.log("  supply:    ", supply);
        console.log("  deployer:  ", deployer);
        console.log("  Safe:      ", safe);

        vm.startBroadcast(deployerKey);

        // Owned by the DEPLOYER at first: it needs minter rights to move balances
        // across. Ownership goes to the Safe at the end of this same broadcast, so
        // there is no window where a hot key owns the token across transactions.
        Scrip impl = new Scrip();
        Scrip scrip = Scrip(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Scrip.initialize, (deployer))
        )));

        scrip.setMinter(deployer, true);
        for (uint256 i; i < holders.length; i++) {
            scrip.mint(holders[i], amounts[i]);
        }
        scrip.setMinter(deployer, false);
        scrip.setMinter(backend, true);

        // New escrow for the new token. See the note above on why this cannot be
        // repointed instead.
        ValorDuel duelImpl = new ValorDuel();
        ValorDuel duel = ValorDuel(address(new ERC1967Proxy(
            address(duelImpl),
            abi.encodeCall(ValorDuel.initialize, (address(scrip), backend, safe, cutBps))
        )));

        scrip.transferOwnership(safe);

        vm.stopBroadcast();

        require(scrip.totalSupply() == supply, "migrated supply does not match the original");

        console.log("");
        console.log("=== migrated ===");
        console.log("NEW Scrip (proxy, USE THIS):", address(scrip));
        console.log("NEW Scrip implementation:   ", address(impl));
        console.log("NEW ValorDuel (proxy):      ", address(duel));
        console.log("NEW ValorDuel implementation:", address(duelImpl));
        console.log("Scrip owner:", scrip.owner());
        console.log("Scrip supply:", scrip.totalSupply());

        console.log("");
        console.log("=== ACTION REQUIRED: execute this through the Safe ===");
        console.log("The marketplace is owned by the Safe, so this script cannot call it.");
        console.log("Until it runs, the shop still charges in the OLD token.");
        console.log("  to:      ", marketplace);
        console.log("  function: setCurrency(address)");
        console.log("  argument:", address(scrip));
        console.logBytes(abi.encodeCall(ValorMarketplace.setCurrency, (address(scrip))));

        console.log("");
        console.log("=== THEN UPDATE ALL OF THESE, or purchases and duels revert ===");
        console.log("  contracts/.env      SCRIP_CONTRACT, AVALANCHE_DUEL_CONTRACT");
        console.log("  Railway (API)       SCRIP_CONTRACT, AVALANCHE_DUEL_CONTRACT");
        console.log("  config.ts           currency.address, contracts.duel");
    }
}
