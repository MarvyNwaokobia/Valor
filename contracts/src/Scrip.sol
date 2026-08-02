// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Scrip — Valor's in-game currency on Avalanche C-Chain
/// @notice Military scrip: currency a force issues to its own people, spendable at
///         its own store and not legal tender anywhere else. That is exactly what
///         this is, and the name is deliberate. Players earn SCRP by playing and
///         spend it in the marketplace, on re-arms and on duel stakes.
///
/// @dev WHY THIS IS NOT REDEEMABLE AT LAUNCH
///      GoodDollar lives on Celo and Fuse, so Avalanche has no proof-of-unique-human
///      available. If SCRP could be sold, one person farming fifty wallets would be
///      worth doing on day one. Because it cannot, it is not. The exit (a SCRP→AVAX
///      swap in the Bank) must be funded from real revenue — marketplace cuts, duel
///      house cuts — never from minted supply, and it needs an identity gate in front
///      of it. Until both exist, SCRP buys things inside Valor and nothing else.
///
///      This contract does not implement the swap on purpose. Adding a redemption
///      path here is the single most expensive change available in this repo, and it
///      should be a separate, reviewed contract with its own funding source rather
///      than a function quietly bolted onto the token.
///
/// @dev SUPPLY
///      Fixed ceiling, minted on demand up to it. A hard cap is what makes the token
///      credible to a player and to a grant committee: "the studio can print without
///      limit" is a much worse thing to have to defend than a number anyone can check.
///      Rewards are issued from minting until the cap, and thereafter from what flows
///      back through sinks.
///
/// @dev PERMIT
///      ERC20Permit (EIP-2612) is included because Valor's marketplace already checks
///      out via a signed permit relayed by the backend, so the player never needs gas.
///      Keeping the same interface means those flows work here unchanged. Note the
///      EIP-712 domain is THIS token's own (name "Scrip", version "1") — it is not
///      G$'s, and copying G$'s domain would produce signatures that verify locally
///      and then revert on-chain.
contract Scrip is ERC20, ERC20Permit, ERC20Burnable, Ownable {
    /// @notice Hard ceiling on total supply. 1 billion SCRP.
    uint256 public constant MAX_SUPPLY = 1_000_000_000e18;

    /// @notice Addresses allowed to mint rewards. The backend relay wallet, and
    ///         later the reward pool contract.
    /// @dev    A set rather than a single address so the relay can be rotated
    ///         without redeploying, and so a compromised relay can be revoked
    ///         without taking the game down.
    mapping(address => bool) public minters;

    event MinterSet(address indexed account, bool allowed);

    error NotMinter(address caller);
    error MaxSupplyExceeded(uint256 requested, uint256 remaining);
    error ZeroAddress();

    modifier onlyMinter() {
        if (!minters[msg.sender]) revert NotMinter(msg.sender);
        _;
    }

    /// @param owner_ Contract owner: can add and remove minters.
    constructor(address owner_) ERC20("Scrip", "SCRP") ERC20Permit("Scrip") Ownable(owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
    }

    /// @notice Allow or revoke an address's ability to mint.
    function setMinter(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        minters[account] = allowed;
        emit MinterSet(account, allowed);
    }

    /// @notice Issue SCRP to a player. Called by the backend when a claim settles.
    /// @dev    Reverts past MAX_SUPPLY rather than silently capping. A partial mint
    ///         would settle a claim for less than the player was owed while the
    ///         database recorded the full amount, which is a discrepancy nobody
    ///         would notice until someone audited the two against each other.
    function mint(address to, uint256 amount) external onlyMinter {
        uint256 remaining = MAX_SUPPLY - totalSupply();
        if (amount > remaining) revert MaxSupplyExceeded(amount, remaining);
        _mint(to, amount);
    }
}
