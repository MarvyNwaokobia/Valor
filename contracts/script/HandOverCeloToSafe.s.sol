// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Moves ownership of every Valor contract on CELO onto the Safe.
///
/// @dev WHY CELO IS A STEP BEHIND AVALANCHE
///      When the relay key was found published, ownership had to move off it
///      immediately and there was no Celo Safe yet. RotateCeloRelay.s.sol parked
///      everything on 0xc6A4… — a wallet whose key had never been in the repo —
///      as the fast move that stopped the bleeding. That left Celo as a single
///      EOA owning five contracts and ~150,000 G$, which is precisely the shape
///      Avalanche had just moved away from. This finishes the job.
///
/// @dev THE KEY THIS NEEDS IS A SAFE SIGNER
///      CELO_OWNER_PRIVATE_KEY is 0xc6A4…, which is also an owner of the 3-of-3
///      Safe on both chains. Putting it in a .env file is the same shape as the
///      leak this project spent a day cleaning up, and with a 3-of-3 it is a
///      third of the multisig sitting on a laptop.
///
///      Use it for this one run and delete the line afterwards. The alternative
///      that never writes a key to disk is Celoscan's "Write as Proxy" tab with
///      the wallet connected in a browser: same five transferOwnership calls, no
///      key on the filesystem. Prefer that if you are not in a hurry.
///
/// @dev ONE-WAY AND IRREVERSIBLE
///      OpenZeppelin's single-step transferOwnership does not wait for the
///      recipient to accept. If VALOR_OWNER_SAFE is wrong, all five contracts
///      become permanently unadministrable and the G$ in the pools is stranded.
///      The script requires the target to be a contract and prints it before
///      acting. Read that line.
///
/// @dev THE RELAY IS UNAFFECTED
///      backendSigner stays 0x65D25f54… on the pools and the record contract, so
///      payouts keep working throughout. This moves ownership only.
///
/// @dev RUN
///   Dry run, and read the output:
///     forge script script/HandOverCeloToSafe.s.sol --rpc-url $CELO_RPC_URL
///   Then:
///     forge script script/HandOverCeloToSafe.s.sol --rpc-url $CELO_RPC_URL --broadcast
contract HandOverCeloToSafe is Script {
    address constant REWARD_POOL  = 0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4;
    address constant ENDLESS_POOL = 0xd44D31645e3abBDc48a6Fc5E6E1bCd894db77Ba0;
    address constant MARKETPLACE  = 0x95D167f569cf05C967C0432e3123baeac5D8d78D;
    address constant ITEMS        = 0x3ba09c51895Dacb90273A2A40C95369a5A1b4bFe;
    address constant GAME_RECORD  = 0xd4ec6dB553E206cdf741448F94bD3B02D81c8571;

    function run() external {
        uint256 ownerKey = vm.envUint("CELO_OWNER_PRIVATE_KEY");
        address current  = vm.addr(ownerKey);
        address safe     = vm.envAddress("VALOR_OWNER_SAFE");

        require(block.chainid == 42220, "not Celo mainnet: check --rpc-url");
        require(safe != address(0), "VALOR_OWNER_SAFE unset");
        require(safe != current, "target is the key you are handing over FROM");
        require(safe.code.length > 0, "VALOR_OWNER_SAFE is not a contract - expected a Safe");

        address[5] memory targets = [REWARD_POOL, ENDLESS_POOL, MARKETPLACE, ITEMS, GAME_RECORD];
        string[5] memory names =
            ["ValorRewardPool", "EndlessPool", "ValorMarketplace", "ValorItems", "ValorGameRecord"];

        console.log("Handing CELO ownership over.");
        console.log("  from:", current);
        console.log("  to  :", safe);
        console.log("");

        vm.startBroadcast(ownerKey);
        for (uint256 i; i < targets.length; i++) {
            address holder = Ownable(targets[i]).owner();
            if (holder == safe) {
                console.log("already the Safe's:", names[i]);
                continue;
            }
            // Skip rather than revert: a mid-loop revert would leave the handover
            // half done, with no record of which half.
            if (holder != current) {
                console.log("NOT OURS, skipping:", names[i]);
                console.log("  owner is:", holder);
                continue;
            }
            Ownable(targets[i]).transferOwnership(safe);
            console.log("transferred:", names[i], targets[i]);
        }
        vm.stopBroadcast();

        console.log("");
        console.log("=== verify, do not take this script's word for it ===");
        console.log("Every owner() below must read", safe);
        for (uint256 i; i < targets.length; i++) {
            console.log(names[i], Ownable(targets[i]).owner());
        }
        console.log("");
        console.log("NOW DELETE CELO_OWNER_PRIVATE_KEY FROM contracts/.env.");
        console.log("It is a Safe signer, and this was its one job.");
    }
}
