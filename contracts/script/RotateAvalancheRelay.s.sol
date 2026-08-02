// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/Scrip.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";
import "../src/ValorGameRecord.sol";

/// @notice Moves every privilege on the Avalanche deployment from one wallet to another.
///
/// @dev WHY THIS IS A SCRIPT AND NOT A LIST OF `cast send` COMMANDS
///      Ordering is a correctness property here, not a preference. `transferOwnership`
///      is single-step in OpenZeppelin 5: the moment it lands, the old key can no
///      longer call anything `onlyOwner`. So every other privileged change MUST happen
///      before it, per contract. Run those by hand in the wrong order and the fix
///      requires the new key to already be set up — which it is not, because that is
///      the step you just skipped. A script makes the order unskippable.
///
/// @dev WHAT MOVES
///      Scrip           — minter granted to NEW, revoked from OLD, then ownership
///      ValorGameRecord — backendSigner set to NEW, then ownership
///      ValorItems      — ownership
///      ValorMarketplace— ownership
///
///      AVAX is NOT moved here. Sending the balance is a separate, reversible step
///      done afterwards with `cast send`, because a script that both drops its own
///      privileges and empties its own gas tank has no way to retry if it half-fails.
///
/// @dev RUN
///   forge script script/RotateAvalancheRelay.s.sol --rpc-url avalanche            # dry run
///   forge script script/RotateAvalancheRelay.s.sol --rpc-url avalanche --broadcast
///
/// @dev ENV
///   AVALANCHE_DEPLOYER_PRIVATE_KEY  — the CURRENT (old) key. Still the owner.
///   AVALANCHE_NEW_RELAY_ADDRESS     — the address taking over.
///   SCRIP_CONTRACT, AVALANCHE_ITEMS_CONTRACT,
///   AVALANCHE_MARKETPLACE_CONTRACT, AVALANCHE_GAME_RECORD_CONTRACT
contract RotateAvalancheRelay is Script {
    function run() external {
        uint256 oldKey = vm.envUint("AVALANCHE_DEPLOYER_PRIVATE_KEY");
        address oldAddr = vm.addr(oldKey);
        address newAddr = vm.envAddress("AVALANCHE_NEW_RELAY_ADDRESS");

        Scrip scrip = Scrip(vm.envAddress("SCRIP_CONTRACT"));
        ValorItems items = ValorItems(vm.envAddress("AVALANCHE_ITEMS_CONTRACT"));
        ValorMarketplace mkt = ValorMarketplace(vm.envAddress("AVALANCHE_MARKETPLACE_CONTRACT"));
        ValorGameRecord rec = ValorGameRecord(vm.envAddress("AVALANCHE_GAME_RECORD_CONTRACT"));

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");
        require(newAddr != address(0), "AVALANCHE_NEW_RELAY_ADDRESS unset");
        // Rotating to the key we are rotating away from would report success and
        // change nothing, which is the worst outcome: you would believe you were safe.
        require(newAddr != oldAddr, "new address equals old address; nothing would rotate");
        // Ownership is single-step and irreversible from our side. An address with no
        // code and no balance is usually a typo, and a typo here bricks all four
        // contracts permanently.
        require(newAddr.balance > 0, "new address has no AVAX; fund it first so a typo cannot brick ownership");

        require(scrip.owner() == oldAddr, "old key does not own Scrip");
        require(items.owner() == oldAddr, "old key does not own ValorItems");
        require(mkt.owner() == oldAddr, "old key does not own ValorMarketplace");
        require(rec.owner() == oldAddr, "old key does not own ValorGameRecord");

        console.log("Rotating from:", oldAddr);
        console.log("Rotating to  :", newAddr);

        vm.startBroadcast(oldKey);

        // ── Scrip ────────────────────────────────────────────────────────────
        // Grant BEFORE revoking, so there is never a moment with no valid minter.
        scrip.setMinter(newAddr, true);
        scrip.setMinter(oldAddr, false);
        scrip.transferOwnership(newAddr);

        // ── ValorGameRecord ──────────────────────────────────────────────────
        // The signer is what actually writes match records; ownership only governs
        // upgrades. Set it before giving ownership away.
        rec.setBackendSigner(newAddr);
        rec.transferOwnership(newAddr);

        // ── The rest ─────────────────────────────────────────────────────────
        items.transferOwnership(newAddr);
        mkt.transferOwnership(newAddr);

        vm.stopBroadcast();

        console.log("");
        console.log("Rotation complete. Remaining manual steps:");
        console.log("  1. Send the old wallet's AVAX to the new one.");
        console.log("  2. Update AVALANCHE_PRIVATE_KEY in apps/api/.env AND in Railway.");
        console.log("  3. Treat the old key as burned. Do not reuse it anywhere.");
    }
}
