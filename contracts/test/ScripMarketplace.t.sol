// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/Scrip.sol";
import "../src/ValorMarketplace.sol";
import "../src/ValorItems.sol";

/// @notice The Avalanche deployment, end to end, with the REAL Scrip contract
///         rather than a mock.
///
/// @dev WHY THIS EXISTS SEPARATELY FROM ValorMarketplace.t.sol
///      That suite uses MockGToken, an ERC-677 stand-in for G$. It proves the
///      marketplace works with a token shaped like GoodDollar. It does NOT prove
///      the marketplace works with Scrip, and the marketplace still declares its
///      token as `IGoodDollar`, so "does a plain ERC20Permit satisfy it?" is a
///      real question with money riding on the answer.
///
///      It does, but only along one of the two purchase paths, and that
///      distinction is the point of this file. Better to learn it here than from
///      a reverted transaction on mainnet after paying to deploy.
contract ScripMarketplaceTest is Test {
    Scrip scrip;
    ValorMarketplace marketplace;
    ValorItems items;

    address owner = makeAddr("owner");
    address relay = makeAddr("relay");
    uint256 buyerKey = 0xBEEF;
    address buyer;

    uint256 constant ITEM_ID = 1;
    uint256 constant PRICE = 3_000e18; // an Ashfall Carbine, in SCRP

    function setUp() public {
        buyer = vm.addr(buyerKey);

        Scrip scripImpl = new Scrip();
        scrip = Scrip(address(new ERC1967Proxy(
            address(scripImpl), abi.encodeCall(Scrip.initialize, (owner))
        )));
        vm.prank(owner);
        scrip.setMinter(relay, true);

        ValorItems itemsImpl = new ValorItems();
        items = ValorItems(address(new ERC1967Proxy(
            address(itemsImpl),
            abi.encodeCall(ValorItems.initialize, (owner))
        )));

        // Exactly the wiring DeployAvalanche.s.sol performs: Scrip in the currency
        // slot the Celo deployment gives to G$.
        ValorMarketplace mktImpl = new ValorMarketplace();
        marketplace = ValorMarketplace(address(new ERC1967Proxy(
            address(mktImpl),
            abi.encodeCall(ValorMarketplace.initialize, (address(scrip), address(items), owner))
        )));

        vm.startPrank(owner);
        items.setMarketplace(address(marketplace));
        items.registerItem(ITEM_ID, 0, "ipfs://ashfall-carbine");
        marketplace.listItem(ITEM_ID, PRICE);
        vm.stopPrank();

        // The player earned this by playing, then claimed it.
        vm.prank(relay);
        scrip.mint(buyer, 10_000e18);
    }

    /// The path the app actually uses: the player signs a permit, the backend
    /// relay submits it, the player never needs gas. If this breaks, every
    /// purchase on Avalanche breaks.
    function test_PurchaseWithPermit_WorksWithRealScrip() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(marketplace), PRICE, deadline);

        // Submitted by the relay, not the buyer. That is the whole point.
        vm.prank(relay);
        marketplace.purchaseWithPermit(buyer, ITEM_ID, deadline, v, r, s);

        assertEq(items.balanceOf(buyer, ITEM_ID), 1, "buyer should own the item");
        assertEq(scrip.balanceOf(buyer), 7_000e18, "price should have left the buyer");
        assertEq(scrip.balanceOf(address(marketplace)), PRICE, "marketplace should hold the revenue");
        assertEq(marketplace.accumulatedRevenue(), PRICE);
    }

    /// Revenue must be withdrawable, because on Avalanche this is the ONLY inbound
    /// money. There is no G$ pool behind it: marketplace cuts are what would fund
    /// a future SCRP redemption, so revenue that cannot be swept is a dead economy.
    function test_RevenueCanBeWithdrawn() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(marketplace), PRICE, deadline);
        vm.prank(relay);
        marketplace.purchaseWithPermit(buyer, ITEM_ID, deadline, v, r, s);

        vm.prank(owner);
        marketplace.withdrawRevenue(owner);
        assertEq(scrip.balanceOf(owner), PRICE);
    }

    /// The ERC-677 path is DEAD on Avalanche and callers must not rely on it.
    ///
    /// ValorMarketplace advertises two ways to buy: `transferAndCall` (ERC-677,
    /// which G$ implements) and the permit relay. Scrip is a plain ERC-20 and has
    /// no transferAndCall, deliberately — adding ERC-677 to hand players a second
    /// path they never use is surface area for nothing. This test pins that
    /// decision so nobody wires a UI to a path that cannot exist here.
    function test_Erc677PathDoesNotExistOnScrip() public {
        (bool ok, ) = address(scrip).call(
            abi.encodeWithSignature(
                "transferAndCall(address,uint256,bytes)",
                address(marketplace), PRICE, abi.encode(ITEM_ID)
            )
        );
        assertFalse(ok, "Scrip must NOT implement ERC-677 transferAndCall");
    }

    /// A permit signed for a different spender must not let the marketplace spend.
    function test_PermitForAnotherSpenderDoesNotFundAPurchase() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(relay, PRICE, deadline);

        vm.expectRevert();
        vm.prank(relay);
        marketplace.purchaseWithPermit(buyer, ITEM_ID, deadline, v, r, s);
    }

    /// The EIP-712 domain the frontend must sign under.
    ///
    /// apps/web/src/editions/avalanche/config.ts declares
    /// `permit: { name: 'Scrip', version: '1' }`. If the contract's real domain
    /// ever diverges from that, every signature verifies in the browser and then
    /// reverts on-chain, which is the single hardest failure in this codebase to
    /// diagnose. This asserts the two agree.
    function test_PermitDomainMatchesTheEditionConfig() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Scrip")),
                keccak256(bytes("1")),
                block.chainid,
                address(scrip)
            )
        );
        assertEq(scrip.DOMAIN_SEPARATOR(), expected, "config.ts permit domain is wrong");
    }

    // ── setCurrency, the Scrip-migration escape hatch ─────────────────────────

    /// The guard that matters. `accumulatedRevenue` is one number, not a balance
    /// per token, so switching currency with revenue outstanding would leave it
    /// denominated in the old token while withdrawRevenue pays out in the new one.
    function test_CurrencyCannotBeSwitchedWhileRevenueIsOutstanding() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(marketplace), PRICE, deadline);
        vm.prank(relay);
        marketplace.purchaseWithPermit(buyer, ITEM_ID, deadline, v, r, s);
        assertGt(marketplace.accumulatedRevenue(), 0, "the purchase should have banked revenue");

        Scrip newScrip = _freshScrip();
        vm.expectRevert(bytes("withdraw revenue before switching currency"));
        vm.prank(owner);
        marketplace.setCurrency(address(newScrip));
    }

    function test_CurrencySwitchesOnceRevenueIsClear() public {
        Scrip newScrip = _freshScrip();
        vm.prank(owner);
        marketplace.setCurrency(address(newScrip));
        assertEq(address(marketplace.gToken()), address(newScrip));
    }

    function test_OnlyOwnerCanSwitchCurrency() public {
        Scrip newScrip = _freshScrip();
        vm.expectRevert();
        vm.prank(relay);
        marketplace.setCurrency(address(newScrip));
    }

    function test_CurrencyCannotBeSetToNothing() public {
        vm.expectRevert(ValorMarketplace.InvalidItemData.selector);
        vm.prank(owner);
        marketplace.setCurrency(address(0));
    }

    function _freshScrip() internal returns (Scrip) {
        Scrip impl = new Scrip();
        return Scrip(address(new ERC1967Proxy(
            address(impl), abi.encodeCall(Scrip.initialize, (owner))
        )));
    }

    function _signPermit(address spender, uint256 value, uint256 deadline)
        internal view returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                buyer, spender, value, scrip.nonces(buyer), deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", scrip.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(buyerKey, digest);
    }
}
