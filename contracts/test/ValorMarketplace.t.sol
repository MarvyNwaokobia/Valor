// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/ValorMarketplace.sol";
import "../src/ValorItems.sol";

/// @dev Minimal ERC20/ERC677 mock for G$ token in tests
contract MockGToken {
    mapping(address => uint256) public balanceOf;
    string public name = "GoodDollar";
    string public symbol = "G$";
    uint8 public decimals = 18;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        IERC677Receiver(to).onTokenTransfer(msg.sender, value, data);
        return true;
    }

    // ERC-20 allowance bits used by the resale buy path.
    mapping(address => mapping(address => uint256)) public allowance;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ValorMarketplaceTest is Test {
    ValorMarketplace marketplace;
    ValorItems items;
    MockGToken gToken;

    address owner = makeAddr("owner");
    address player = makeAddr("player");
    uint256 constant ITEM_ID = 1;
    uint256 constant PRICE = 10e18; // 10 G$

    function setUp() public {
        gToken = new MockGToken();

        ValorItems itemsImpl = new ValorItems();
        items = ValorItems(address(new ERC1967Proxy(
            address(itemsImpl),
            abi.encodeCall(ValorItems.initialize, (owner))
        )));

        ValorMarketplace marketplaceImpl = new ValorMarketplace();
        marketplace = ValorMarketplace(address(new ERC1967Proxy(
            address(marketplaceImpl),
            abi.encodeCall(ValorMarketplace.initialize, (address(gToken), address(items), owner))
        )));

        vm.startPrank(owner);
        items.setMarketplace(address(marketplace));
        items.registerItem(ITEM_ID, 0, "ipfs://sword");
        marketplace.listItem(ITEM_ID, PRICE);
        vm.stopPrank();

        gToken.mint(player, 100e18);
    }

    function test_PurchaseItem() public {
        vm.prank(player);
        gToken.transferAndCall(address(marketplace), PRICE, abi.encode(ITEM_ID));
        assertEq(items.balanceOf(player, ITEM_ID), 1);
    }

    function test_ExcessRefunded() public {
        uint256 overpay = PRICE + 5e18;
        vm.prank(player);
        gToken.transferAndCall(address(marketplace), overpay, abi.encode(ITEM_ID));
        // Player gets refund of 5 G$
        assertEq(gToken.balanceOf(player), 100e18 - PRICE);
    }

    function test_InsufficientPaymentReverts() public {
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(ValorMarketplace.InsufficientPayment.selector, PRICE - 1, PRICE)
        );
        gToken.transferAndCall(address(marketplace), PRICE - 1, abi.encode(ITEM_ID));
    }

    function test_UnlistedItemReverts() public {
        vm.prank(player);
        vm.expectRevert(ValorMarketplace.ItemNotListed.selector);
        gToken.transferAndCall(address(marketplace), PRICE, abi.encode(uint256(999)));
    }

    function test_OnlyGTokenCanCall() public {
        vm.prank(player);
        vm.expectRevert("Only G$ token");
        marketplace.onTokenTransfer(player, PRICE, abi.encode(ITEM_ID));
    }

    function test_RevenueAccumulates() public {
        vm.prank(player);
        gToken.transferAndCall(address(marketplace), PRICE, abi.encode(ITEM_ID));
        assertEq(marketplace.accumulatedRevenue(), PRICE);
    }

    function test_WithdrawRevenue() public {
        vm.prank(player);
        gToken.transferAndCall(address(marketplace), PRICE, abi.encode(ITEM_ID));
        vm.prank(owner);
        marketplace.withdrawRevenue(owner);
        assertEq(gToken.balanceOf(owner), PRICE);
        assertEq(marketplace.accumulatedRevenue(), 0);
    }

    function test_LimitedSupplyThroughMarketplace() public {
        vm.prank(owner);
        items.registerItem(2, 1, "ipfs://rare");
        vm.prank(owner);
        marketplace.listItem(2, PRICE);

        address player2 = makeAddr("player2");
        gToken.mint(player2, 100e18);

        vm.prank(player);
        gToken.transferAndCall(address(marketplace), PRICE, abi.encode(uint256(2)));

        vm.prank(player2);
        vm.expectRevert(ValorItems.MaxSupplyReached.selector);
        gToken.transferAndCall(address(marketplace), PRICE, abi.encode(uint256(2)));
    }

    // ── Resale ────────────────────────────────────────────────────────────────

    address seller = makeAddr("seller");
    address buyer  = makeAddr("buyer");
    uint256 constant RESALE_PRICE = 20e18;

    /// Mint the seller item 1 via a normal house purchase, then approve resale.
    function _sellerOwnsAndApproves() internal {
        gToken.mint(seller, PRICE);
        vm.prank(seller);
        gToken.transferAndCall(address(marketplace), PRICE, abi.encode(ITEM_ID));
        assertEq(items.balanceOf(seller, ITEM_ID), 1);
        vm.prank(seller);
        items.setApprovalForAll(address(marketplace), true);
    }

    function test_ResaleFlow_TransfersItemAndSplitsFee() public {
        vm.prank(owner);
        marketplace.setFeeBps(500); // 5%
        _sellerOwnsAndApproves();

        vm.prank(seller);
        uint256 resaleId = marketplace.listForResale(ITEM_ID, RESALE_PRICE);

        uint256 revBefore = marketplace.accumulatedRevenue(); // house sale already counted

        gToken.mint(buyer, RESALE_PRICE);
        vm.startPrank(buyer);
        gToken.approve(address(marketplace), RESALE_PRICE);
        marketplace.buyResale(resaleId);
        vm.stopPrank();

        // Item moved seller -> buyer.
        assertEq(items.balanceOf(buyer, ITEM_ID), 1);
        assertEq(items.balanceOf(seller, ITEM_ID), 0);

        // Seller got price minus the 5% fee; the fee is the platform's revenue.
        uint256 fee = (RESALE_PRICE * 500) / 10000;
        assertEq(gToken.balanceOf(seller), RESALE_PRICE - fee);
        assertEq(marketplace.accumulatedRevenue() - revBefore, fee);

        // Listing is gone from the active set.
        assertEq(marketplace.getActiveResaleCount(), 0);
    }

    function test_ListRequiresApproval() public {
        gToken.mint(seller, PRICE);
        vm.prank(seller);
        gToken.transferAndCall(address(marketplace), PRICE, abi.encode(ITEM_ID));

        vm.prank(seller);
        vm.expectRevert(ValorMarketplace.MarketplaceNotApproved.selector);
        marketplace.listForResale(ITEM_ID, RESALE_PRICE);
    }

    function test_ListRequiresOwnership() public {
        vm.prank(seller);
        items.setApprovalForAll(address(marketplace), true);
        vm.prank(seller);
        vm.expectRevert(ValorMarketplace.NotItemOwner.selector);
        marketplace.listForResale(ITEM_ID, RESALE_PRICE);
    }

    function test_CannotBuyOwnListing() public {
        _sellerOwnsAndApproves();
        vm.prank(seller);
        uint256 resaleId = marketplace.listForResale(ITEM_ID, RESALE_PRICE);

        gToken.mint(seller, RESALE_PRICE);
        vm.startPrank(seller);
        gToken.approve(address(marketplace), RESALE_PRICE);
        vm.expectRevert(ValorMarketplace.CannotBuyOwnListing.selector);
        marketplace.buyResale(resaleId);
        vm.stopPrank();
    }

    function test_CancelResale() public {
        _sellerOwnsAndApproves();
        vm.prank(seller);
        uint256 resaleId = marketplace.listForResale(ITEM_ID, RESALE_PRICE);
        assertEq(marketplace.getActiveResaleCount(), 1);

        vm.prank(seller);
        marketplace.cancelResale(resaleId);
        assertEq(marketplace.getActiveResaleCount(), 0);

        // A cancelled listing can't be bought.
        gToken.mint(buyer, RESALE_PRICE);
        vm.startPrank(buyer);
        gToken.approve(address(marketplace), RESALE_PRICE);
        vm.expectRevert(ValorMarketplace.ResaleNotActive.selector);
        marketplace.buyResale(resaleId);
        vm.stopPrank();
    }

    function test_OnlySellerCancels() public {
        _sellerOwnsAndApproves();
        vm.prank(seller);
        uint256 resaleId = marketplace.listForResale(ITEM_ID, RESALE_PRICE);
        vm.prank(buyer);
        vm.expectRevert(ValorMarketplace.NotSeller.selector);
        marketplace.cancelResale(resaleId);
    }

    function test_SetFeeBpsCapped() public {
        vm.prank(owner);
        vm.expectRevert(ValorMarketplace.FeeTooHigh.selector);
        marketplace.setFeeBps(2001);
    }
}
