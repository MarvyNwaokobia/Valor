// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/ValorRewardPool.sol";

contract MockGToken2 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ValorRewardPoolTest is Test {
    ValorRewardPool pool;
    MockGToken2 gToken;

    address owner = makeAddr("owner");
    address backend = makeAddr("backend");
    address player = makeAddr("player");

    function setUp() public {
        gToken = new MockGToken2();
        ValorRewardPool impl = new ValorRewardPool();
        pool = ValorRewardPool(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ValorRewardPool.initialize, (address(gToken), backend, owner))
        )));
        gToken.mint(address(pool), 10_000e18); // Fund pool
    }

    function test_BronzeRankUpReward() public {
        vm.prank(backend);
        pool.distributeRankUpReward(player, "Bronze");
        assertEq(gToken.balanceOf(player), 10e18);
    }

    function test_DiamondRankUpReward() public {
        vm.prank(backend);
        pool.distributeRankUpReward(player, "Diamond");
        assertEq(gToken.balanceOf(player), 150e18);
    }

    function test_DailyClaimAmount() public {
        vm.prank(backend);
        pool.distributeDailyClaim(player);
        assertEq(gToken.balanceOf(player), 5e18);
    }

    function test_OnlyBackendCanDistribute() public {
        vm.prank(player);
        vm.expectRevert(ValorRewardPool.OnlyBackend.selector);
        pool.distributeRankUpReward(player, "Gold");
    }

    function test_InsufficientPoolBalance() public {
        MockGToken2 smallToken = new MockGToken2();
        ValorRewardPool impl = new ValorRewardPool();
        ValorRewardPool smallPool = ValorRewardPool(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ValorRewardPool.initialize, (address(smallToken), backend, owner))
        )));
        // Pool has 0 balance
        vm.prank(backend);
        vm.expectRevert(ValorRewardPool.InsufficientPoolBalance.selector);
        smallPool.distributeRankUpReward(player, "Bronze");
    }

    function test_UpdateBackendSigner() public {
        address newBackend = makeAddr("newBackend");
        vm.prank(owner);
        pool.setBackendSigner(newBackend);
        vm.prank(newBackend);
        pool.distributeRankUpReward(player, "Silver");
        assertEq(gToken.balanceOf(player), 20e18);
    }

    function test_PoolBalance() public view {
        assertEq(pool.poolBalance(), 10_000e18);
    }
}
