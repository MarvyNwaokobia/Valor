// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Moves ownership of every Valor contract on Avalanche C-Chain off the
///         backend relay key and onto a Safe.
///
/// @dev THE PROBLEM THIS FIXES
///      After RotateAvalancheRelay.s.sol, one address — 0x25496AC7… — ended up being
///      all of these at once:
///
///        • the Scrip minter, and Scrip's OWNER, so it can appoint further minters
///        • the authorised writer on ValorGameRecord, and its owner
///        • the owner of ValorItems and ValorMarketplace, hence their UUPS upgrade
///          authority, hence able to replace their logic outright
///        • the backend relay signing automated transactions from a live server
///
///      That is a hot key with unlimited mint authority and upgrade rights over
///      every contract holding player property. It is the single finding most likely
///      to end a grant review, and it is entirely avoidable.
///
///      After this script the relay keeps exactly what it needs to run the game —
///      minting rewards and writing match records — and nothing it does not. Every
///      administrative power moves behind the Safe.
///
/// @dev WHAT IS DELIBERATELY LEFT WITH THE RELAY
///      Scrip minting. The backend mints SCRP when a player claims accrued balance,
///      which happens on demand and cannot wait on a multisig signing ceremony. The
///      exposure is bounded by MAX_SUPPLY and, more importantly, by the fact that
///      after this script the Safe can revoke that minter in one transaction without
///      the relay's cooperation. Before this script it could not.
///
/// @dev ONE-WAY AND IRREVERSIBLE
///      `transferOwnership` here is OpenZeppelin's single-step version: it does not
///      wait for the recipient to accept. If VALOR_OWNER_SAFE is wrong, every
///      contract below is permanently unadministrable. The script requires the target
///      to be a contract, refuses to run if it is the relay, and prints the address
///      before doing anything. Read that line before you confirm.
///
/// @dev RUN
///   Dry run, and actually read the output:
///     forge script script/HandOverToSafe.s.sol --rpc-url $AVALANCHE_RPC_URL
///   Then:
///     forge script script/HandOverToSafe.s.sol --rpc-url $AVALANCHE_RPC_URL --broadcast
///
/// @dev REQUIRED ENV (contracts/.env)
///   AVALANCHE_DEPLOYER_PRIVATE_KEY  — must currently OWN the contracts (the relay key)
///   VALOR_OWNER_SAFE                — the Safe that takes over
///   SCRIP_CONTRACT, AVALANCHE_ITEMS_CONTRACT,
///   AVALANCHE_MARKETPLACE_CONTRACT, AVALANCHE_GAME_RECORD_CONTRACT
///   AVALANCHE_DUEL_CONTRACT         — optional; skipped if unset, since ValorDuel is
///                                     deployed owned by the Safe already and only
///                                     needs this if it was deployed before the Safe.
contract HandOverToSafe is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("AVALANCHE_DEPLOYER_PRIVATE_KEY");
        address current  = vm.addr(ownerKey);
        address safe     = vm.envAddress("VALOR_OWNER_SAFE");

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");
        require(safe != address(0), "VALOR_OWNER_SAFE unset");
        require(safe != current, "target is the key you are handing over FROM");
        require(safe.code.length > 0, "VALOR_OWNER_SAFE is not a contract - expected a Safe");

        address[5] memory targets = [
            vm.envAddress("SCRIP_CONTRACT"),
            vm.envAddress("AVALANCHE_ITEMS_CONTRACT"),
            vm.envAddress("AVALANCHE_MARKETPLACE_CONTRACT"),
            vm.envAddress("AVALANCHE_GAME_RECORD_CONTRACT"),
            vm.envOr("AVALANCHE_DUEL_CONTRACT", address(0))
        ];
        string[5] memory names = ["Scrip", "ValorItems", "ValorMarketplace", "ValorGameRecord", "ValorDuel"];

        console.log("Handing ownership over.");
        console.log("  from (relay):", current);
        console.log("  to   (Safe): ", safe);
        console.log("");

        vm.startBroadcast(ownerKey);
        for (uint256 i; i < targets.length; i++) {
            address t = targets[i];
            if (t == address(0)) {
                console.log("skipped (unset):", names[i]);
                continue;
            }
            address holder = Ownable(t).owner();
            if (holder == safe) {
                console.log("already the Safe's:", names[i]);
                continue;
            }
            // A contract we do not currently own would revert mid-loop and leave the
            // handover half done. Say so plainly and skip instead.
            if (holder != current) {
                console.log("NOT OURS, skipping:", names[i]);
                console.log("  owner is:", holder);
                continue;
            }
            Ownable(t).transferOwnership(safe);
            console.log("transferred:", names[i], t);
        }
        vm.stopBroadcast();

        console.log("");
        console.log("=== verify before trusting this ===");
        console.log("Every owner() below must read", safe);
        for (uint256 i; i < targets.length; i++) {
            if (targets[i] == address(0)) continue;
            console.log(names[i], Ownable(targets[i]).owner());
        }
        console.log("");
        console.log("The relay KEEPS: Scrip minting, GameRecord writing, duel resolving.");
        console.log("The relay LOSES: upgrades, minter management, revenue withdrawal, fee changes.");
    }
}
