// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/Scrip.sol";
import "../src/ValorItems.sol";
import "../src/ValorMarketplace.sol";
import "../src/ValorGameRecord.sol";

/// @notice Deploys Valor onto Avalanche C-Chain (chain id 43114).
///
/// @dev WHAT IS AND IS NOT DEPLOYED HERE, AND WHY
///
///      Deployed:
///        Scrip            — the in-game currency. NOT redeemable; see Scrip.sol.
///        ValorItems       — the item registry (ERC-1155).
///        ValorMarketplace — buying and reselling, priced in SCRP.
///        ValorGameRecord  — match records. This is the transaction-volume driver
///                           and the thing a grant reviewer actually counts.
///
///      NOT deployed:
///        ValorRewardPool  — it holds and distributes G$, which does not exist on
///                           Avalanche. Scrip rewards are minted directly by the
///                           relay when a claim settles (services/earnings.rs), so
///                           there is no pool to fund and no pool-floor taper. Do
///                           not port the Celo reward pool here without redesigning
///                           it; a pool that mints its own currency is not a pool.
///
/// @dev RUN
///   forge script script/DeployAvalanche.s.sol --rpc-url $AVALANCHE_RPC_URL --broadcast --verify
///
///   Dry run first (no --broadcast) and read the gas total. The deployer needs AVAX,
///   not CELO: this is a different chain and the Celo relay's balance is irrelevant
///   here.
///
/// @dev REQUIRED ENV (contracts/.env)
///
///   AVALANCHE_DEPLOYER_PRIVATE_KEY   — deployer wallet, funded with AVAX
///   AVALANCHE_BACKEND_SIGNER_ADDRESS — the relay wallet ADDRESS (not its key).
///                                      Becomes a Scrip minter and the authorised
///                                      writer on ValorGameRecord. It needs AVAX of
///                                      its own for every match record it writes.
///
///   These are AVALANCHE_-prefixed, and there is deliberately NO fallback to the
///   unprefixed DEPLOYER_PRIVATE_KEY / BACKEND_SIGNER_ADDRESS that Deploy.s.sol
///   (Celo) uses. Two reasons:
///
///     1. One .env serves both chains. Sharing the names means filling in Avalanche
///        values overwrites the Celo ones, and the next Celo deploy or upgrade
///        silently uses the wrong wallet.
///     2. Falling back would let a missing variable quietly deploy Avalanche from
///        the Celo relay key — the exact key that holds and pays out real G$. A
///        loud failure is much cheaper than discovering that later.
///
/// @dev AFTER DEPLOYING
///   1. Record every address printed below into apps/web/src/editions/avalanche/config.ts
///      and the API env. NEVER type an address from memory — copy it from this output
///      or from Snowtrace.
///   2. Fund the relay with AVAX. An unfunded relay fails every write, which is the
///      single most common cause of failed payouts in this project's history.
///   3. Register items on ValorItems + ValorMarketplace before they can be bought;
///      a purchase builds a permit against the on-chain listing, so an unregistered
///      item reverts. See RegisterNewItems.s.sol for the Celo equivalent.
contract DeployAvalanche is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("AVALANCHE_DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address backend     = vm.envAddress("AVALANCHE_BACKEND_SIGNER_ADDRESS");

        require(block.chainid == 43114, "not Avalanche C-Chain: check --rpc-url");
        require(backend != address(0), "AVALANCHE_BACKEND_SIGNER_ADDRESS unset");

        console.log("Deployer:", deployer);
        console.log("Deployer AVAX balance:", deployer.balance);
        console.log("Relay (backend signer):", backend);
        // A deploy that runs out of gas halfway leaves contracts you have paid for
        // but cannot use, and the addresses printed at the end never appear.
        require(deployer.balance > 0, "deployer has no AVAX");

        vm.startBroadcast(deployerKey);

        // 1. Currency. Plain contract, not a proxy: a token whose logic can be
        //    swapped underneath holders is a much bigger trust ask than an
        //    upgradeable game contract, and this one has no reason to change.
        Scrip scrip = new Scrip(deployer);
        scrip.setMinter(backend, true);

        // 2. Item registry.
        ValorItems itemsImpl = new ValorItems();
        ERC1967Proxy itemsProxy = new ERC1967Proxy(
            address(itemsImpl),
            abi.encodeCall(ValorItems.initialize, (deployer))
        );

        // 3. Marketplace, priced in SCRP rather than G$. Note the argument order:
        //    initialize(_gToken, _items, _owner). SCRP takes the currency slot.
        ValorMarketplace mktImpl = new ValorMarketplace();
        ERC1967Proxy mktProxy = new ERC1967Proxy(
            address(mktImpl),
            abi.encodeCall(ValorMarketplace.initialize, (address(scrip), address(itemsProxy), deployer))
        );
        ValorItems(address(itemsProxy)).setMarketplace(address(mktProxy));

        // 4. Match records. The volume driver.
        //    initialize(_backendSigner, _owner) — backend first.
        ValorGameRecord recImpl = new ValorGameRecord();
        ERC1967Proxy recProxy = new ERC1967Proxy(
            address(recImpl),
            abi.encodeCall(ValorGameRecord.initialize, (backend, deployer))
        );

        vm.stopBroadcast();

        console.log("=== Valor on Avalanche C-Chain (43114) ===");
        console.log("Scrip (SCRP)     ", address(scrip));
        console.log("ValorItems       ", address(itemsProxy));
        console.log("ValorMarketplace ", address(mktProxy));
        console.log("ValorGameRecord  ", address(recProxy));
        console.log("");
        console.log("Relay (minter + record writer):", backend);
        console.log("FUND THAT ADDRESS WITH AVAX or every write fails.");
    }
}
