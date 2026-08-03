# The upgradeable-contract pattern

Every Valor contract on every chain is a **UUPS proxy owned by a Safe multisig**.
New contracts follow this. This file is the pattern.

> A Valor contract is deployed as an implementation behind an `ERC1967Proxy`,
> initialised rather than constructed, and owned by the Safe. The backend relay
> gets narrow operational rights and never ownership.

Two addresses come out of every deploy. **The proxy address is the contract.** It
goes in `.env`, in `editions/*/config.ts`, and in anything a player signs
against. The implementation address changes on the first upgrade and matters only
for verification.

---

## Writing a new contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract ValorSomething is OwnableUpgradeable, UUPSUpgradeable {
    uint256 public someState;

    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) public initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @dev Reserved so a later version can add state without colliding.
    uint256[49] private __gap;
}
```

Five things, each of which has cost someone real money somewhere:

1. **`constructor()` calls `_disableInitializers()`.** Without it the
   implementation is initialisable by anyone, and because it is the UUPS logic
   contract, whoever seizes it can point every proxy at something else. There is
   a `test_ImplementationCannotBeInitialised` on both `Scrip` and `ValorDuel`.
   Copy it.
2. **State is set in `initialize`, never in a constructor.** A proxy never runs
   the implementation's constructor, so anything set there is silently zero on
   the contract people actually use.
3. **No `immutable` state.** Same reason. `ValorDuel.scrip` was `immutable` and
   had to become a plain variable when it moved behind a proxy.
4. **`_authorizeUpgrade` is `onlyOwner`.** This is the upgrade key. Leave it open
   and anyone replaces the contract.
5. **End with a `__gap`.** Reserved slots so a later version can add state.

### Two OpenZeppelin 5.6 gotchas

**There is no `ReentrancyGuardUpgradeable`.** OZ 5.6 does not ship one. Use the
plain `@openzeppelin/contracts/utils/ReentrancyGuard.sol`, as `ValorMarketplace`
and `ValorDuel` both do. It is safe behind a proxy: the guard's first read sees
`0` rather than `NOT_ENTERED`, which is still not the `ENTERED` value, so the
check passes and the slot is correct from then on.

**`UUPSUpgradeable` has no `__UUPSUpgradeable_init()`.** The upgradeable package
re-exports the non-upgradeable contract, because UUPS holds no storage. Calling
the init does not compile.

---

## Deploying

```solidity
Something impl = new Something();
Something thing = Something(address(new ERC1967Proxy(
    address(impl),
    abi.encodeCall(Something.initialize, (owner))
)));
```

Guards every deploy script should carry, all of which exist in
`DeployValorDuel.s.sol`:

- `require(block.chainid == 43114, ...)` so a wrong `--rpc-url` fails loudly
- `require(safe.code.length > 0, ...)` so a mistyped EOA cannot take ownership
  irreversibly
- `require(safe != relay, ...)` so the hot key never becomes owner
- Print the proxy address, labelled, and say which one to copy

Always dry-run without `--broadcast` first. Always deploy with `--verify`:
unverified contracts are unreadable to players, auditors and grant reviewers, and
verifying later is more work than doing it now.

---

## Who holds what

| Role | Address | Can | Cannot |
|---|---|---|---|
| **Safe** (`VALOR_OWNER_SAFE`) | multisig | Upgrade, appoint minters, set fees, withdraw revenue | Touch escrowed duel stakes |
| **Relay** (`0x25496AC7…`) | hot key on the server | Mint claimed rewards, write match records, settle duels | Upgrade, change fees, withdraw revenue, redirect a payout |

The split is the whole security story. The relay signs automated transactions
from a live server, so it is the key most likely to be compromised, and it is
deliberately given the least. `script/HandOverToSafe.s.sol` is what puts things
this way round. Before it runs, the relay owns everything.

**This matters more now that contracts are upgradeable.** An upgrade key can
rewrite any rule any contract documents. Those rules are guarantees of the
current code, not of the address, and what backs them is that changing them takes
several people signing something publicly visible rather than one server key. A
timelock on the upgrade path is the next hardening step and is not done yet.

---

## Upgrading

Deploy the new implementation, then propose the `upgradeToAndCall` in the Safe UI
and collect signatures.

Storage rules, in order of how expensive they are to break:

- **Never reorder or remove an existing variable.** Append only.
- **Never change a variable's type.**
- Take new slots from `__gap` and shrink it by the same count, so the total holds.
- Use `reinitializer(n)` for one-off setup on an upgrade, as `initializeResale()`
  does. Never `initializer` twice.

---

## Current state on Avalanche

| Contract | Proxy | Upgradeable? |
|---|---|---|
| Scrip (SCRP) | `0xc5D41940D3EAa734895574a53b8bD4F61CF173b6` | yes |
| ValorItems | `0x9a7890532b7581c7fea587f01ca6b876cd017677` | yes |
| ValorMarketplace | `0x751fBFFFc9419BC825645cD69661e51Ae2D529f6` | yes |
| ValorGameRecord | `0xb6394d320e941674292a5c8db48f069f46bc77a6` | yes |
| ValorDuel | `0x82C3d4a6C0595bA7B97E83c6B49925519766615d` | yes |

✅ **All of them, as of 2026-08-03.** Scrip was the last holdout: the original was
a plain contract, and bytecode cannot be moved behind a proxy after the fact, so
`MigrateScrip.s.sol` redeployed it and re-minted all 60 holders. Every balance was
checked against chain afterwards and none mismatched. `ValorDuel` was redeployed in
the same run, because its token is fixed at initialize with no setter.

The old token `0x9e3cFd517111D6d458e0Aa51deCAC66413388537` is abandoned. Nothing
references it and nothing should.

---

## Scripts

| Script | What it does |
|---|---|
| `DeployAvalanche.s.sol` | First deploy: Scrip, Items, Marketplace, GameRecord |
| `DeployValorDuel.s.sol` | The staked-duel escrow. Needs `VALOR_OWNER_SAFE` |
| `MigrateScrip.s.sol` | Replaces the plain Scrip with a proxy, moves holders |
| `HandOverToSafe.s.sol` | Moves every ownership off the relay onto the Safe |
| `BurnTestScrip.s.sol` | Burns the 1,125 SCRP of deploy-time test mints |
| `RegisterAvalancheItems.s.sol` | Registers and lists the item catalogue |
| `RotateAvalancheRelay.s.sol` | Rotates the relay key |
