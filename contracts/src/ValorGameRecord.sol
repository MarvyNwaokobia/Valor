// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ValorGameRecord — Immutable on-chain log of game events (UUPS upgradeable)
/// @notice Backend emits events here after each significant game action.
///         Events are permanent and publicly verifiable on Celo.
contract ValorGameRecord is OwnableUpgradeable, UUPSUpgradeable {
    // The backend signer is the only address authorized to record events
    address public backendSigner;

    event CharacterClaimed(
        address indexed player,
        string characterClass,
        string characterName,
        uint256 timestamp
    );

    event BattleRecorded(
        bytes32 indexed battleId,
        address indexed winner,
        address indexed loser,
        uint8 xpWinner,
        uint8 xpLoser,
        bool isBot,
        uint256 timestamp
    );

    event RankUp(
        address indexed player,
        string newRank,
        uint256 timestamp
    );

    error OnlyBackend();
    error ZeroAddress();

    modifier onlyBackend() {
        if (msg.sender != backendSigner) revert OnlyBackend();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _backendSigner, address _owner) public initializer {
        __Ownable_init(_owner);
        if (_backendSigner == address(0)) revert ZeroAddress();
        backendSigner = _backendSigner;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Record that a player claimed (created) their character
    function claimCharacter(
        address player,
        string calldata characterClass,
        string calldata characterName
    ) external onlyBackend {
        emit CharacterClaimed(player, characterClass, characterName, block.timestamp);
    }

    /// @notice Record the outcome of a battle
    /// @param battleId  UUID of the battle (16 bytes, zero-padded to 32)
    /// @param winner    Winning wallet (address(0) = bot)
    /// @param loser     Losing wallet (address(0) = bot)
    /// @param xpWinner  XP awarded to winner
    /// @param xpLoser   XP awarded to loser
    /// @param isBot     True if this was a bot fight
    function recordBattle(
        bytes32 battleId,
        address winner,
        address loser,
        uint8 xpWinner,
        uint8 xpLoser,
        bool isBot
    ) external onlyBackend {
        emit BattleRecorded(battleId, winner, loser, xpWinner, xpLoser, isBot, block.timestamp);
    }

    /// @notice Record that a player ranked up
    function recordRankUp(address player, string calldata newRank) external onlyBackend {
        emit RankUp(player, newRank, block.timestamp);
    }

    function setBackendSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        backendSigner = _signer;
    }
}
