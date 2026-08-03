// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/ValorDuel.sol";

/// @notice Deploys the staked-duel escrow onto Avalanche C-Chain (43114).
///
/// @dev WHY THIS IS A SEPARATE SCRIPT FROM DeployAvalanche.s.sol
///      That script ran once and its output is already recorded in
///      editions/avalanche/config.ts. Re-running it to add one contract would
///      redeploy Scrip and every proxy, orphaning the live addresses and stranding
///      the SCRP players already hold. New contract, new script.
///
/// @dev THE OWNER MUST NOT BE THE RELAY
///      The whole security argument for this contract is that the key which settles
///      duels cannot withdraw revenue or rewrite the rules, and the key which can do
///      those things is not sitting on a server. Passing the relay as owner collapses
///      both roles back into one address and throws the property away, so the script
///      refuses to do it.
///
///      The owner is also required to be a CONTRACT, which in practice means a Safe.
///      Ownership transfer is one-way and irreversible: a typo into an address nobody
///      controls permanently freezes the house cut and the resolver rotation. A
///      contract check will not catch every mistake, but it catches the whole class
///      of mistyped EOAs, which is the likely one.
///
/// @dev RUN
///   forge script script/DeployValorDuel.s.sol --rpc-url $AVALANCHE_RPC_URL --broadcast --verify
///
///   Dry-run without --broadcast first and read the addresses it echoes back.
///
/// @dev REQUIRED ENV (contracts/.env)
///   AVALANCHE_DEPLOYER_PRIVATE_KEY   — pays gas. Does NOT become the owner.
///   SCRIP_CONTRACT                   — the live Scrip token.
///   AVALANCHE_BACKEND_SIGNER_ADDRESS — becomes the resolver (settles duels).
///   VALOR_OWNER_SAFE                 — becomes the owner (cold multisig).
///   DUEL_HOUSE_CUT_BPS               — optional, defaults to 50 (0.5%), matching
///                                      the rate the Celo duel handler charges.
contract DeployValorDuel is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("AVALANCHE_DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address scrip       = vm.envAddress("SCRIP_CONTRACT");
        address resolver    = vm.envAddress("AVALANCHE_BACKEND_SIGNER_ADDRESS");
        address safe        = vm.envAddress("VALOR_OWNER_SAFE");
        uint16  cutBps      = uint16(vm.envOr("DUEL_HOUSE_CUT_BPS", uint256(50)));

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");
        require(scrip != address(0), "SCRIP_CONTRACT unset");
        require(resolver != address(0), "AVALANCHE_BACKEND_SIGNER_ADDRESS unset");
        require(safe != address(0), "VALOR_OWNER_SAFE unset");
        require(safe != resolver, "owner must not be the relay: that is the whole point");
        require(safe.code.length > 0, "VALOR_OWNER_SAFE is not a contract - expected a Safe");
        require(deployer.balance > 0, "deployer has no AVAX");

        // Cheap sanity check that SCRIP_CONTRACT really is Scrip and not, say, the
        // marketplace address pasted into the wrong variable. The token address is
        // immutable in the escrow, so getting it wrong means redeploying.
        require(scrip.code.length > 0, "SCRIP_CONTRACT has no code");

        console.log("Deployer (gas only):", deployer);
        console.log("Scrip:              ", scrip);
        console.log("Resolver (relay):   ", resolver);
        console.log("Owner (Safe):       ", safe);
        console.log("House cut (bps):    ", cutBps);

        vm.startBroadcast(deployerKey);
        // UUPS, like every other Valor contract. The proxy address is the one that
        // goes in config; the implementation is an implementation detail that will
        // change on the first upgrade.
        ValorDuel duelImpl = new ValorDuel();
        ValorDuel duel = ValorDuel(address(new ERC1967Proxy(
            address(duelImpl),
            abi.encodeCall(ValorDuel.initialize, (scrip, resolver, safe, cutBps))
        )));
        vm.stopBroadcast();

        console.log("");
        console.log("=== ValorDuel deployed ===");
        console.log("ValorDuel (proxy, USE THIS):", address(duel));
        console.log("ValorDuel (implementation): ", address(duelImpl));
        console.log("");
        console.log("Next:");
        console.log("  1. Set AVALANCHE_DUEL_CONTRACT in the API env and redeploy the backend.");
        console.log("  2. Set duel.address in apps/web/src/editions/avalanche/config.ts.");
        console.log("  3. The relay needs AVAX: it pays gas for every open, accept and resolve.");
    }
}
