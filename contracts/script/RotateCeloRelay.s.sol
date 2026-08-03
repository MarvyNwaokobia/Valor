// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ISignerRole {
    function setBackendSigner(address signer) external;
    function backendSigner() external view returns (address);
}

/// @notice Emergency rotation of the Celo relay after its private key was found
///         published in a public repository.
///
/// @dev WHAT HAPPENED
///      `scripts/register-gooddollar.mjs` line 14 hardcoded the private key for
///      0x43a5BA0da132b21bdACfBc4392b72EeBaF6f2D82. It was committed on
///      2026-06-06 in 84784ce and pushed to github.com/MarvyNwaokobia/Valor,
///      which is public. The key was readable by anyone for roughly two months.
///
///      That address was, at the time of discovery, simultaneously:
///        • owner of ValorRewardPool  (holding ~76,886 G$)
///        • owner of the Endless pool (holding ~73,071 G$)
///        • owner of ValorMarketplace, ValorItems, ValorGameRecord on Celo,
///          therefore the UUPS upgrade authority on all three
///        • backendSigner on the pools and the record contract
///        • holder of ~27.7 CELO
///        • one of four signers on the Avalanche Safe
///
///      Roughly 150,000 G$ was drainable by anyone who had read the file.
///
/// @dev WHAT THIS SCRIPT DOES, AND THE ORDER IT MUST RUN IN
///      Ordering is load-bearing and not obvious. `setBackendSigner` is
///      `onlyOwner`, so EVERY signer change has to happen BEFORE ownership moves.
///      Transfer first and the old key can no longer fix the signers, leaving the
///      contracts pointing at a compromised operator with nobody able to change it.
///
///        1. setBackendSigner(new relay) on RewardPool, EndlessPool, GameRecord
///        2. fund the new relay with CELO so it can actually operate
///        3. transferOwnership(cold owner) on all five contracts
///        4. sweep the remaining CELO off the compromised key
///
/// @dev WHY THE OWNER IS AN EOA AND NOT A SAFE
///      Because a Safe on Celo does not exist yet and creating one needs a browser.
///      This is the fast move that stops the bleeding, not the final shape. The
///      owner becomes a wallet whose key has never been in this repository or on a
///      server. Creating a Celo Safe and moving ownership onto it is the follow-up,
///      and until that happens Celo is a single-key setup again, which is exactly
///      the weakness Avalanche just moved away from.
///
/// @dev THIS DOES NOT UN-COMPROMISE ANYTHING
///      The key is public and stays public. Forks, clones and mirrors of the repo
///      keep it forever. Rotation is the fix; purging git history afterwards is
///      tidying, not remediation. 0x43a5… must never be funded or granted a role
///      again, and must be removed as a signer on the Avalanche Safe.
///
/// @dev RUN
///   Dry run first:
///     forge script script/RotateCeloRelay.s.sol --rpc-url $CELO_RPC_URL
///   Then:
///     forge script script/RotateCeloRelay.s.sol --rpc-url $CELO_RPC_URL --broadcast
///
/// @dev REQUIRED ENV
///   DEPLOYER_PRIVATE_KEY      — the COMPROMISED key. Still needed: it is the only
///                               thing that can hand its own roles away.
///   CELO_NEW_RELAY_ADDRESS    — the new hot relay (operations only).
///   CELO_COLD_OWNER           — takes ownership. Must not be the relay, old or new.
contract RotateCeloRelay is Script {
    // Celo mainnet. Cross-check against the deployment records before editing.
    address constant REWARD_POOL  = 0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4;
    address constant ENDLESS_POOL = 0xd44D31645e3abBDc48a6Fc5E6E1bCd894db77Ba0;
    address constant MARKETPLACE  = 0x95D167f569cf05C967C0432e3123baeac5D8d78D;
    address constant ITEMS        = 0x3ba09c51895Dacb90273A2A40C95369a5A1b4bFe;
    address constant GAME_RECORD  = 0xd4ec6dB553E206cdf741448F94bD3B02D81c8571;

    /// CELO left with the new relay so it can pay gas immediately. The rest is
    /// swept; this is a working float, not a reserve.
    uint256 constant RELAY_FLOAT = 20 ether;

    function run() external {
        uint256 oldKey   = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oldRelay = vm.addr(oldKey);
        address newRelay = vm.envAddress("CELO_NEW_RELAY_ADDRESS");
        address coldOwner = vm.envAddress("CELO_COLD_OWNER");

        require(block.chainid == 42220, "not Celo mainnet: check --rpc-url");
        require(newRelay != address(0) && coldOwner != address(0), "new relay / cold owner unset");
        require(newRelay != oldRelay, "new relay is the compromised key");
        require(coldOwner != oldRelay, "cold owner is the compromised key");
        require(coldOwner != newRelay, "owner must not be the relay: that is the whole point");

        console.log("Rotating Celo away from the COMPROMISED key.");
        console.log("  compromised (old relay):", oldRelay);
        console.log("  new relay (operations): ", newRelay);
        console.log("  new owner (cold):       ", coldOwner);
        console.log("  old relay CELO balance: ", oldRelay.balance);

        vm.startBroadcast(oldKey);

        // 1. Operator role first, while we still own these.
        ISignerRole(REWARD_POOL).setBackendSigner(newRelay);
        ISignerRole(ENDLESS_POOL).setBackendSigner(newRelay);
        ISignerRole(GAME_RECORD).setBackendSigner(newRelay);
        console.log("backendSigner moved on RewardPool, EndlessPool, GameRecord");

        // 2. Give the new relay gas before the old key stops being useful.
        if (oldRelay.balance > RELAY_FLOAT) {
            (bool ok, ) = newRelay.call{value: RELAY_FLOAT}("");
            require(ok, "float transfer to new relay failed");
            console.log("funded new relay with (wei):", RELAY_FLOAT);
        }

        // 3. Ownership last. After this the old key can do nothing.
        Ownable(REWARD_POOL).transferOwnership(coldOwner);
        Ownable(ENDLESS_POOL).transferOwnership(coldOwner);
        Ownable(MARKETPLACE).transferOwnership(coldOwner);
        Ownable(ITEMS).transferOwnership(coldOwner);
        Ownable(GAME_RECORD).transferOwnership(coldOwner);
        console.log("ownership transferred on all five contracts");

        vm.stopBroadcast();

        console.log("");
        console.log("=== verify, do not take this script's word for it ===");
        console.log("owner() must read", coldOwner);
        console.log("  RewardPool  ", Ownable(REWARD_POOL).owner());
        console.log("  EndlessPool ", Ownable(ENDLESS_POOL).owner());
        console.log("  Marketplace ", Ownable(MARKETPLACE).owner());
        console.log("  Items       ", Ownable(ITEMS).owner());
        console.log("  GameRecord  ", Ownable(GAME_RECORD).owner());
        console.log("backendSigner must read", newRelay);
        console.log("  RewardPool  ", ISignerRole(REWARD_POOL).backendSigner());
        console.log("  EndlessPool ", ISignerRole(ENDLESS_POOL).backendSigner());
        console.log("  GameRecord  ", ISignerRole(GAME_RECORD).backendSigner());
        console.log("");
        console.log("STILL TO DO BY HAND:");
        console.log("  - BACKEND_PRIVATE_KEY on Railway -> the new relay, then redeploy");
        console.log("  - remove 0x43a5...2D82 as a signer on the Avalanche Safe");
        console.log("  - sweep the last of the CELO off the old key");
        console.log("  - delete the key from scripts/register-gooddollar.mjs");
    }
}
