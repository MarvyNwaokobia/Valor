// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IGoodDollar.sol";

/// @title ValorRewardPool — Holds G$ and distributes rank-up + daily claim rewards (UUPS upgradeable)
/// @notice Backend calls distributeReward() after verifying XP milestone on-chain
contract ValorRewardPool is OwnableUpgradeable, ReentrancyGuard, UUPSUpgradeable {
    IGoodDollar public gToken;

    // Authorized backend address that can trigger distributions
    address public backendSigner;

    // Rank => reward amount in G$ (18 decimals)
    mapping(string => uint256) public rankRewards;

    uint256 public constant DAILY_CLAIM_AMOUNT = 5e18; // 5 G$

    // ── Generic one-time bounties (e.g. first-clear rewards). Appended storage,
    //    so this stays UUPS-upgrade-safe. `ref` makes each bounty idempotent
    //    on-chain: a given ref pays out at most once, ever. ──
    uint256 public constant MAX_REWARD = 10000e18; // hard cap on any single bounty
    mapping(bytes32 => bool) public rewardRefUsed;

    event RewardDistributed(address indexed player, string rank, uint256 amount);
    event DailyClaimDistributed(address indexed player, uint256 amount);
    event BountyDistributed(address indexed player, uint256 amount, bytes32 indexed ref);
    event BackendSignerUpdated(address indexed signer);
    event FundsDeposited(address indexed from, uint256 amount);

    error OnlyBackend();
    error InsufficientPoolBalance();
    error ZeroAddress();
    error BadAmount();
    error RefAlreadyUsed();

    modifier onlyBackend() {
        if (msg.sender != backendSigner) revert OnlyBackend();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _gToken, address _backendSigner, address _owner) public initializer {
        __Ownable_init(_owner);
        if (_gToken == address(0) || _backendSigner == address(0)) revert ZeroAddress();
        gToken = IGoodDollar(_gToken);
        backendSigner = _backendSigner;

        // Set rank rewards
        rankRewards["Bronze"]   = 10e18;
        rankRewards["Silver"]   = 20e18;
        rankRewards["Gold"]     = 40e18;
        rankRewards["Platinum"] = 80e18;
        rankRewards["Diamond"]  = 150e18;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function distributeRankUpReward(address player, string calldata newRank)
        external
        onlyBackend
        nonReentrant
    {
        uint256 amount = rankRewards[newRank];
        require(amount > 0, "Unknown rank");
        if (gToken.balanceOf(address(this)) < amount) revert InsufficientPoolBalance();

        gToken.transfer(player, amount);
        emit RewardDistributed(player, newRank, amount);
    }

    /// @notice Pay an arbitrary one-time bounty (first-clear, competition, etc.).
    /// @dev `ref` is a caller-chosen idempotency key — the same ref can only ever
    ///      pay once, so a retrying/duplicating backend can never double-spend.
    function distributeReward(address player, uint256 amount, bytes32 ref)
        external
        onlyBackend
        nonReentrant
    {
        if (player == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > MAX_REWARD) revert BadAmount();
        if (rewardRefUsed[ref]) revert RefAlreadyUsed();
        if (gToken.balanceOf(address(this)) < amount) revert InsufficientPoolBalance();

        rewardRefUsed[ref] = true; // set BEFORE transfer (checks-effects-interactions)
        gToken.transfer(player, amount);
        emit BountyDistributed(player, amount, ref);
    }

    function distributeDailyClaim(address player) external onlyBackend nonReentrant {
        if (gToken.balanceOf(address(this)) < DAILY_CLAIM_AMOUNT) revert InsufficientPoolBalance();
        gToken.transfer(player, DAILY_CLAIM_AMOUNT);
        emit DailyClaimDistributed(player, DAILY_CLAIM_AMOUNT);
    }

    function setBackendSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        backendSigner = _signer;
        emit BackendSignerUpdated(_signer);
    }

    function setRankReward(string calldata rank, uint256 amount) external onlyOwner {
        rankRewards[rank] = amount;
    }

    function poolBalance() external view returns (uint256) {
        return gToken.balanceOf(address(this));
    }
}
