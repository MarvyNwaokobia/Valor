// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGoodDollar {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title ValorRewardPool — Holds G$ and distributes rank-up + daily claim rewards
/// @notice Backend calls distributeReward() after verifying XP milestone on-chain
contract ValorRewardPool is Ownable, ReentrancyGuard {
    IGoodDollar public immutable gToken;

    // Authorized backend address that can trigger distributions
    address public backendSigner;

    // Rank => reward amount in G$ (18 decimals)
    mapping(string => uint256) public rankRewards;

    uint256 public constant DAILY_CLAIM_AMOUNT = 5e18; // 5 G$

    event RewardDistributed(address indexed player, string rank, uint256 amount);
    event DailyClaimDistributed(address indexed player, uint256 amount);
    event BackendSignerUpdated(address indexed signer);
    event FundsDeposited(address indexed from, uint256 amount);

    error OnlyBackend();
    error InsufficientPoolBalance();
    error ZeroAddress();

    modifier onlyBackend() {
        if (msg.sender != backendSigner) revert OnlyBackend();
        _;
    }

    constructor(address _gToken, address _backendSigner, address _owner) Ownable(_owner) {
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
