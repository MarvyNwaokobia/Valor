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

    // ── Generic one-time bounties (first-clear rewards) ──
    function test_DistributeReward() public {
        bytes32 ref = keccak256("first_clear:1:player");
        vm.prank(backend);
        pool.distributeReward(player, 12e18, ref);
        assertEq(gToken.balanceOf(player), 12e18);
        assertTrue(pool.rewardRefUsed(ref));
    }

    function test_DistributeReward_OnlyBackend() public {
        vm.prank(player);
        vm.expectRevert(ValorRewardPool.OnlyBackend.selector);
        pool.distributeReward(player, 12e18, keccak256("x"));
    }

    function test_DistributeReward_IdempotentByRef() public {
        bytes32 ref = keccak256("first_clear:5:player");
        vm.prank(backend);
        pool.distributeReward(player, 30e18, ref);
        // the SAME ref can never pay twice — a retry reverts, no double-spend
        vm.prank(backend);
        vm.expectRevert(ValorRewardPool.RefAlreadyUsed.selector);
        pool.distributeReward(player, 30e18, ref);
        assertEq(gToken.balanceOf(player), 30e18);
    }

    function test_DistributeReward_RejectsZeroAndOverCap() public {
        uint256 overCap = pool.MAX_REWARD() + 1; // read the view BEFORE expectRevert

        vm.prank(backend);
        vm.expectRevert(ValorRewardPool.BadAmount.selector);
        pool.distributeReward(player, 0, keccak256("a"));

        vm.prank(backend);
        vm.expectRevert(ValorRewardPool.BadAmount.selector);
        pool.distributeReward(player, overCap, keccak256("b"));
    }

    function test_DistributeReward_InsufficientBalance() public {
        MockGToken2 smallToken = new MockGToken2();
        ValorRewardPool impl = new ValorRewardPool();
        ValorRewardPool smallPool = ValorRewardPool(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ValorRewardPool.initialize, (address(smallToken), backend, owner))
        )));
        vm.prank(backend);
        vm.expectRevert(ValorRewardPool.InsufficientPoolBalance.selector);
        smallPool.distributeReward(player, 12e18, keccak256("c"));
    }
}
