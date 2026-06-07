// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "./ValorItems.sol";
import "./interfaces/IGoodDollar.sol";

interface IERC677Receiver {
    function onTokenTransfer(address from, uint256 value, bytes calldata data) external;
}

/// @title ValorMarketplace — Accepts G$ via transferAndCall or gasless permit relay
/// @notice Two purchase paths:
///   1. transferAndCall  — user calls G$.transferAndCall(marketplace, price, itemId) directly
///   2. purchaseWithPermit — user signs EIP-2612 permit off-chain; backend relays the tx (no CELO gas for user)
contract ValorMarketplace is IERC677Receiver, OwnableUpgradeable, ReentrancyGuard, UUPSUpgradeable {
    IGoodDollar public gToken;
    ValorItems public items;

    struct MarketItem {
        uint256 itemId;
        uint256 price;   // in G$ wei (18 decimals)
        bool active;
    }

    // onchain item id => MarketItem
    mapping(uint256 => MarketItem) public listings;
    uint256[] public listedItemIds;

    // Revenue accumulator — owner can withdraw
    uint256 public accumulatedRevenue;

    event ItemListed(uint256 indexed itemId, uint256 price);
    event ItemDelisted(uint256 indexed itemId);
    event ItemPurchased(address indexed buyer, uint256 indexed itemId, uint256 price);
    event RevenueWithdrawn(address indexed to, uint256 amount);

    error ItemNotListed();
    error InsufficientPayment(uint256 sent, uint256 required);
    error InvalidItemData();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _gToken, address _items, address _owner) public initializer {
        __Ownable_init(_owner);
        gToken = IGoodDollar(_gToken);
        items = ValorItems(_items);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Path 1 — called by the G$ ERC677 token on transferAndCall
    /// @param from  Buyer wallet
    /// @param value Amount of G$ sent (in wei)
    /// @param data  ABI-encoded uint256 itemId
    function onTokenTransfer(address from, uint256 value, bytes calldata data)
        external
        override
        nonReentrant
    {
        require(msg.sender == address(gToken), "Only G$ token");

        if (data.length < 32) revert InvalidItemData();
        uint256 itemId = abi.decode(data, (uint256));

        MarketItem storage listing = listings[itemId];
        if (!listing.active) revert ItemNotListed();
        if (value < listing.price) revert InsufficientPayment(value, listing.price);

        uint256 excess = value - listing.price;
        accumulatedRevenue += listing.price;

        if (excess > 0) {
            gToken.transfer(from, excess);
        }

        items.mint(from, itemId, 1);
        emit ItemPurchased(from, itemId, listing.price);
    }

    /// @notice Path 2 — gasless purchase via EIP-2612 permit
    /// @dev Caller (Valor backend) pays gas; buyer signs a permit off-chain so no CELO needed from them
    /// @param buyer    Player's wallet address
    /// @param itemId   On-chain item ID (must be listed)
    /// @param deadline Permit expiry (unix timestamp)
    /// @param v        Permit signature v
    /// @param r        Permit signature r
    /// @param s        Permit signature s
    function purchaseWithPermit(
        address buyer,
        uint256 itemId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        MarketItem storage listing = listings[itemId];
        if (!listing.active) revert ItemNotListed();

        uint256 price = listing.price;

        // Consume the permit — allows this contract to spend exactly `price` G$ from buyer
        IERC20Permit(address(gToken)).permit(buyer, address(this), price, deadline, v, r, s);

        // Pull G$ from buyer to this contract
        IERC20(address(gToken)).transferFrom(buyer, address(this), price);

        accumulatedRevenue += price;
        items.mint(buyer, itemId, 1);

        emit ItemPurchased(buyer, itemId, price);
    }

    function listItem(uint256 itemId, uint256 price) external onlyOwner {
        listings[itemId] = MarketItem({ itemId: itemId, price: price, active: true });
        listedItemIds.push(itemId);
        emit ItemListed(itemId, price);
    }

    function delistItem(uint256 itemId) external onlyOwner {
        listings[itemId].active = false;
        emit ItemDelisted(itemId);
    }

    function withdrawRevenue(address to) external onlyOwner nonReentrant {
        uint256 amount = accumulatedRevenue;
        accumulatedRevenue = 0;
        gToken.transfer(to, amount);
        emit RevenueWithdrawn(to, amount);
    }

    function getListedItemCount() external view returns (uint256) {
        return listedItemIds.length;
    }
}
