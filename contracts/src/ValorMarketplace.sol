// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ValorItems.sol";

import "./interfaces/IGoodDollar.sol";

interface IERC677Receiver {
    function onTokenTransfer(address from, uint256 value, bytes calldata data) external;
}

/// @title ValorMarketplace — Accepts G$ via transferAndCall, mints item NFTs
/// @notice Single-tx purchases: player calls G$.transferAndCall(marketplace, price, itemId)
contract ValorMarketplace is IERC677Receiver, Ownable, ReentrancyGuard {
    IGoodDollar public immutable gToken;
    ValorItems public immutable items;

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

    constructor(address _gToken, address _items, address _owner) Ownable(_owner) {
        gToken = IGoodDollar(_gToken);
        items = ValorItems(_items);
    }

    /// @notice Called by the G$ ERC677 token on transferAndCall
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

        // Refund excess
        uint256 excess = value - listing.price;
        accumulatedRevenue += listing.price;

        if (excess > 0) {
            gToken.transfer(from, excess);
        }

        // Mint the item NFT to the buyer
        items.mint(from, itemId, 1);

        emit ItemPurchased(from, itemId, listing.price);
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
