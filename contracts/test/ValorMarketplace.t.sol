// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
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
        vm.startPrank(owner);
        items = new ValorItems(owner);
        marketplace = new ValorMarketplace(address(gToken), address(items), owner);
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
}
