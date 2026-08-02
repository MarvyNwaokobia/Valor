// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Scrip.sol";

contract ScripTest is Test {
    Scrip scrip;
    address owner  = makeAddr("owner");
    address relay  = makeAddr("relay");
    address player = makeAddr("player");
    address rando  = makeAddr("rando");

    function setUp() public {
        scrip = new Scrip(owner);
        vm.prank(owner);
        scrip.setMinter(relay, true);
    }

    function test_Metadata() public view {
        assertEq(scrip.name(), "Scrip");
        assertEq(scrip.symbol(), "SCRP");
        assertEq(scrip.decimals(), 18);
        assertEq(scrip.totalSupply(), 0, "nothing is pre-minted; supply grows only as players earn");
    }

    function test_MinterCanMint() public {
        vm.prank(relay);
        scrip.mint(player, 500e18);
        assertEq(scrip.balanceOf(player), 500e18);
    }

    /// The whole point of the minter set: anyone else minting would let a
    /// compromised or careless account issue unlimited rewards.
    function test_NonMinterCannotMint() public {
        vm.expectRevert(abi.encodeWithSelector(Scrip.NotMinter.selector, rando));
        vm.prank(rando);
        scrip.mint(player, 1e18);
    }

    /// The owner is NOT implicitly a minter. Ownership is for managing minters;
    /// conflating the two is how a key that only needed admin rights ends up
    /// able to print money.
    function test_OwnerIsNotAutomaticallyAMinter() public {
        vm.expectRevert(abi.encodeWithSelector(Scrip.NotMinter.selector, owner));
        vm.prank(owner);
        scrip.mint(player, 1e18);
    }

    function test_MinterCanBeRevoked() public {
        vm.prank(owner);
        scrip.setMinter(relay, false);

        vm.expectRevert(abi.encodeWithSelector(Scrip.NotMinter.selector, relay));
        vm.prank(relay);
        scrip.mint(player, 1e18);
    }

    function test_OnlyOwnerSetsMinters() public {
        vm.expectRevert();
        vm.prank(rando);
        scrip.setMinter(rando, true);
    }

    function test_CapIsEnforced() public {
        // Read the cap BEFORE the prank: vm.prank applies to the next call, and a
        // view call on the token would be the one to consume it.
        uint256 cap = scrip.MAX_SUPPLY();

        vm.prank(relay);
        scrip.mint(player, cap);
        assertEq(scrip.totalSupply(), cap);

        // One wei past the cap must revert, not silently mint less. A partial
        // mint would settle a claim for less than the database says was owed.
        vm.expectRevert(abi.encodeWithSelector(Scrip.MaxSupplyExceeded.selector, 1, 0));
        vm.prank(relay);
        scrip.mint(player, 1);
    }

    function test_BurningFreesCapRoom() public {
        uint256 cap = scrip.MAX_SUPPLY();

        vm.prank(relay);
        scrip.mint(player, cap);

        // Sinks (marketplace spend, re-arms) can burn, and burnt supply becomes
        // mintable again — that is what lets the economy keep running at the cap.
        vm.prank(player);
        scrip.burn(100e18);

        vm.prank(relay);
        scrip.mint(player, 100e18);
        assertEq(scrip.totalSupply(), cap);
    }

    /// Marketplace checkout relays a signed permit so the player needs no gas.
    /// If this breaks, every purchase on Avalanche breaks.
    function test_PermitGivesAllowanceWithoutGasFromTheOwner() public {
        uint256 pk = 0xA11CE;
        address signer = vm.addr(pk);

        vm.prank(relay);
        scrip.mint(signer, 1_000e18);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                signer, relay, 250e18, scrip.nonces(signer), deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", scrip.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        // Anyone may submit it; that is the point of a relayed permit.
        vm.prank(rando);
        scrip.permit(signer, relay, 250e18, deadline, v, r, s);

        assertEq(scrip.allowance(signer, relay), 250e18);

        vm.prank(relay);
        scrip.transferFrom(signer, relay, 250e18);
        assertEq(scrip.balanceOf(relay), 250e18);
    }

    /// A replayed permit must fail. The nonce is what stops one signature being
    /// used twice to drain an account.
    function test_PermitCannotBeReplayed() public {
        uint256 pk = 0xB0B;
        address signer = vm.addr(pk);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                signer, relay, 1e18, scrip.nonces(signer), deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", scrip.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        scrip.permit(signer, relay, 1e18, deadline, v, r, s);

        vm.expectRevert();
        scrip.permit(signer, relay, 1e18, deadline, v, r, s);
    }

    function test_ConstructorRejectsZeroOwner() public {
        vm.expectRevert();
        new Scrip(address(0));
    }
}
