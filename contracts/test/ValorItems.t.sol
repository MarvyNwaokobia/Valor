// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/ValorItems.sol";

contract ValorItemsTest is Test {
    ValorItems items;
    address owner = makeAddr("owner");
    address marketplace = makeAddr("marketplace");
    address player = makeAddr("player");

    function setUp() public {
        ValorItems impl = new ValorItems();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ValorItems.initialize, (owner))
        );
        items = ValorItems(address(proxy));
        vm.prank(owner);
        items.setMarketplace(marketplace);
    }

    function test_RegisterItem() public {
        vm.prank(owner);
        items.registerItem(1, 100, "ipfs://item1");
        assertEq(items.maxSupply(1), 100);
    }

    function test_MintItem() public {
        vm.prank(owner);
        items.registerItem(1, 100, "ipfs://item1");
        vm.prank(marketplace);
        items.mint(player, 1, 1);
        assertEq(items.balanceOf(player, 1), 1);
        assertEq(items.totalMinted(1), 1);
    }

    function test_MaxSupplyEnforced() public {
        vm.prank(owner);
        items.registerItem(2, 2, "ipfs://item2");
        vm.startPrank(marketplace);
        items.mint(player, 2, 1);
        items.mint(player, 2, 1);
        vm.expectRevert(ValorItems.MaxSupplyReached.selector);
        items.mint(player, 2, 1);
        vm.stopPrank();
    }

    function test_UnlimitedSupply() public {
        vm.prank(owner);
        items.registerItem(3, 0, "ipfs://item3"); // 0 = unlimited
        vm.prank(marketplace);
        items.mint(player, 3, 1000);
        assertEq(items.remainingSupply(3), type(uint256).max);
    }

    function test_OnlyMarketplaceCanMint() public {
        vm.prank(owner);
        items.registerItem(4, 0, "ipfs://item4");
        vm.prank(player);
        vm.expectRevert(ValorItems.OnlyMarketplace.selector);
        items.mint(player, 4, 1);
    }

    function test_UriReturned() public {
        vm.prank(owner);
        items.registerItem(5, 0, "ipfs://item5");
        assertEq(items.uri(5), "ipfs://item5");
    }
}
