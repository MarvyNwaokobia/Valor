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
   contract, whoever seizes it can point every proxy at something else. Every
   contract in `src/` does this; write a test that asserts a direct
   `initialize()` on the implementation reverts.
2. **State is set in `initialize`, never in a constructor.** A proxy never runs
   the implementation's constructor, so anything set there is silently zero on
   the contract people actually use.
3. **No `immutable` state.** Same reason: an `immutable` is written into the
   implementation's bytecode at construction, so a proxy delegating into it reads
   the deployer's value rather than its own. Use a plain variable set in
   `initialize`.
4. **`_authorizeUpgrade` is `onlyOwner`.** This is the upgrade key. Leave it open
   and anyone replaces the contract.
5. **End with a `__gap`.** Reserved slots so a later version can add state.

### Two OpenZeppelin 5.6 gotchas

**There is no `ReentrancyGuardUpgradeable`.** OZ 5.6 does not ship one. Use the
plain `@openzeppelin/contracts/utils/ReentrancyGuard.sol`, as `ValorMarketplace`
does. It is safe behind a proxy: the guard's first read sees
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

Guards every deploy script should carry:

- `require(block.chainid == 42220, ...)` so a wrong `--rpc-url` fails loudly
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
| **Safe** (`VALOR_OWNER_SAFE`) | multisig | Upgrade, set fees, withdraw revenue, fund and drain the pools | — |
| **Relay** (`0x65D25f54…`) | hot key on the server | Distribute rewards, write match records, settle duels | Upgrade, change fees, withdraw revenue, redirect a payout |

The split is the whole security story. The relay signs automated transactions
from a live server, so it is the key most likely to be compromised, and it is
deliberately given the least. `script/HandOverCeloToSafe.s.sol` is what puts
things this way round. Before it runs, the relay owns everything.

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

## Current state on Celo

| Contract | Proxy | Upgradeable? |
|---|---|---|
| ValorRewardPool | `0x12a3f711A55f4dB0e9AF26C7429cc5018401F1f4` | yes |
| EndlessPool | `0xd44D31645e3abBDc48a6Fc5E6E1bCd894db77Ba0` | yes |
| ValorMarketplace | `0x95D167f569cf05C967C0432e3123baeac5D8d78D` | yes |
| ValorItems | `0x3ba09c51895Dacb90273A2A40C95369a5A1b4bFe` | yes |
| ValorGameRecord | `0xd4ec6dB553E206cdf741448F94bD3B02D81c8571` | yes |

Celo is the only chain Valor runs on. `G_TOKEN_ADDRESS` in
`apps/web/src/lib/constants.ts` is GoodDollar's own token and is not ours to
upgrade.

---

## Scripts

| Script | What it does |
|---|---|
| `Deploy.s.sol` | First deploy: Items, Marketplace, GameRecord, RewardPool |
| `Setup.s.sol` | Post-deploy wiring |
| `DeployEndlessPool.s.sol` | The separate Endless reward pool |
| `UpgradeMarketplace.s.sol` / `UpgradeRewardPool.s.sol` | New implementations |
| `RegisterNewItems.s.sol`, `RegisterFieldKit.s.sol`, `RegisterSeasonalWeapons.s.sol` | Catalogue registration and listing |
| `HandOverCeloToSafe.s.sol` | Moves every ownership off the relay onto the Safe |
| `RotateCeloRelay.s.sol` | Rotates the relay key |
