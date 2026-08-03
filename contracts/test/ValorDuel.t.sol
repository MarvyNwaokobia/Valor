// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/Scrip.sol";
import "../src/ValorDuel.sol";

contract ValorDuelTest is Test {
    Scrip scrip;
    ValorDuel duel;

    address scripOwner = makeAddr("scripOwner");
    address owner      = makeAddr("owner");     // cold / Safe
    address resolver   = makeAddr("resolver");  // hot backend relay
    address treasury   = makeAddr("treasury");
    address rando      = makeAddr("rando");

    // Real keys, because staking goes through EIP-2612 and a permit needs a signature
    // that actually verifies. `makeAddr` alone cannot sign.
    uint256 aliceKey = 0xA11CE;
    uint256 bobKey   = 0xB0B;
    address alice;
    address bob;

    bytes32 constant DUEL = keccak256("duel-1");
    uint256 constant STAKE = 1_000e18;
    uint16  constant CUT_BPS = 50; // 0.5%

    function setUp() public {
        alice = vm.addr(aliceKey);
        bob   = vm.addr(bobKey);

        Scrip scripImpl = new Scrip();
        scrip = Scrip(address(new ERC1967Proxy(
            address(scripImpl), abi.encodeCall(Scrip.initialize, (scripOwner))
        )));
        vm.prank(scripOwner);
        scrip.setMinter(address(this), true);
        scrip.mint(alice, 10_000e18);
        scrip.mint(bob, 10_000e18);

        duel = _deployDuel(address(scrip), resolver, owner, CUT_BPS);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _permitSig(uint256 key, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address signer = vm.addr(key);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                signer,
                spender,
                value,
                scrip.nonces(signer),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", scrip.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(key, digest);
    }

    function _open(bytes32 id, uint256 stake) internal {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(aliceKey, address(duel), stake, deadline);
        vm.prank(resolver);
        duel.openWithPermit(id, alice, stake, deadline, v, r, s);
    }

    function _accept(bytes32 id, uint256 stake) internal {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(bobKey, address(duel), stake, deadline);
        vm.prank(resolver);
        duel.acceptWithPermit(id, bob, deadline, v, r, s);
    }

    function _openAndAccept() internal {
        _open(DUEL, STAKE);
        _accept(DUEL, STAKE);
    }

    // ── the happy path ────────────────────────────────────────────────────────

    function test_FullDuelPaysTheWinnerAndRetainsTheCut() public {
        _openAndAccept();

        assertEq(scrip.balanceOf(address(duel)), STAKE * 2, "both stakes are escrowed by the contract");
        assertEq(duel.escrowedBalance(), STAKE * 2, "none of it is revenue yet");

        vm.prank(resolver);
        duel.resolve(DUEL, alice);

        uint256 pot = STAKE * 2;
        uint256 cut = (pot * CUT_BPS) / 10_000;
        assertEq(scrip.balanceOf(alice), 10_000e18 - STAKE + (pot - cut), "winner takes the pot minus the cut");
        assertEq(scrip.balanceOf(bob), 10_000e18 - STAKE, "loser is out their stake");
        assertEq(duel.accumulatedRevenue(), cut);
        assertEq(duel.escrowedBalance(), 0, "no player money is left held");
    }

    function test_StakeMovesOnlyOnceEachSide() public {
        _openAndAccept();
        assertEq(scrip.balanceOf(alice), 10_000e18 - STAKE);
        assertEq(scrip.balanceOf(bob), 10_000e18 - STAKE);
    }

    function test_DrawRefundsBothAndTakesNothing() public {
        _openAndAccept();

        vm.prank(resolver);
        duel.resolveDraw(DUEL);

        assertEq(scrip.balanceOf(alice), 10_000e18, "made whole");
        assertEq(scrip.balanceOf(bob), 10_000e18, "made whole");
        assertEq(duel.accumulatedRevenue(), 0, "the house does not bill for a non-result");
    }

    function test_WinnerPayoutViewMatchesWhatIsActuallyPaid() public {
        // The UI quotes this number before a player stakes. If it ever disagreed with
        // the transfer, players would be told one figure and paid another.
        uint256 quoted = duel.winnerPayout(STAKE);
        _openAndAccept();
        uint256 before = scrip.balanceOf(alice);
        vm.prank(resolver);
        duel.resolve(DUEL, alice);
        assertEq(scrip.balanceOf(alice) - before, quoted);
    }

    // ── the security property that bounds a stolen resolver key ───────────────

    function test_ResolverCannotPayAnAddressOutsideTheDuel() public {
        _openAndAccept();
        vm.expectRevert(ValorDuel.WinnerNotInDuel.selector);
        vm.prank(resolver);
        duel.resolve(DUEL, rando);
    }

    function test_ResolverCannotWithdrawRevenue() public {
        _openAndAccept();
        vm.prank(resolver);
        duel.resolve(DUEL, alice);

        vm.expectRevert();
        vm.prank(resolver);
        duel.withdrawRevenue(resolver);
    }

    function test_OwnerCannotTouchLiveEscrow() public {
        _openAndAccept();
        // Everything the owner is allowed to do, while two live stakes sit in the
        // contract. None of it may move a player's money.
        vm.startPrank(owner);
        duel.setResolver(rando);
        duel.setHouseCutBps(100);
        duel.withdrawRevenue(treasury);
        vm.stopPrank();

        assertEq(scrip.balanceOf(treasury), 0, "no revenue existed to withdraw");
        assertEq(scrip.balanceOf(address(duel)), STAKE * 2, "escrow untouched");
    }

    function test_OnlyResolverCanSettle() public {
        _openAndAccept();
        vm.expectRevert(ValorDuel.NotResolver.selector);
        vm.prank(rando);
        duel.resolve(DUEL, alice);

        vm.expectRevert(ValorDuel.NotResolver.selector);
        vm.prank(owner);
        duel.resolve(DUEL, alice);
    }

    function test_RevenueWithdrawalCannotReachEscrowedStakes() public {
        // One duel settles, banking a cut. A second is live. Withdrawing revenue must
        // take the cut and stop, even though both sit in the same balance.
        _openAndAccept();
        vm.prank(resolver);
        duel.resolve(DUEL, alice);
        uint256 cut = duel.accumulatedRevenue();

        bytes32 second = keccak256("duel-2");
        _open(second, STAKE);
        _accept(second, STAKE);

        vm.prank(owner);
        duel.withdrawRevenue(treasury);

        assertEq(scrip.balanceOf(treasury), cut);
        assertEq(scrip.balanceOf(address(duel)), STAKE * 2, "the live duel is fully covered");
        assertEq(duel.accumulatedRevenue(), 0);
    }

    // ── the escape hatch ──────────────────────────────────────────────────────

    function test_AnAbandonedDuelRefundsBothSidesAfterTheWindow() public {
        _openAndAccept();

        vm.expectRevert(ValorDuel.TooEarlyToReclaim.selector);
        duel.reclaim(DUEL);

        vm.warp(block.timestamp + duel.RESOLVE_WINDOW());
        // Deliberately called by a stranger: the whole point is that it needs nobody's
        // permission and nobody's key.
        vm.prank(rando);
        duel.reclaim(DUEL);

        assertEq(scrip.balanceOf(alice), 10_000e18);
        assertEq(scrip.balanceOf(bob), 10_000e18);
        assertEq(duel.accumulatedRevenue(), 0, "no cut on a duel we failed to settle");
    }

    function test_AnUnacceptedDuelIsReclaimableAfterTheOpenWindow() public {
        _open(DUEL, STAKE);

        vm.warp(block.timestamp + duel.OPEN_WINDOW() - 1);
        vm.expectRevert(ValorDuel.TooEarlyToReclaim.selector);
        duel.reclaim(DUEL);

        vm.warp(block.timestamp + 1);
        duel.reclaim(DUEL);
        assertEq(scrip.balanceOf(alice), 10_000e18);
    }

    function test_ReclaimCannotBeRunTwice() public {
        _openAndAccept();
        vm.warp(block.timestamp + duel.RESOLVE_WINDOW());
        duel.reclaim(DUEL);

        vm.expectRevert(ValorDuel.DuelNotAccepted.selector);
        duel.reclaim(DUEL);
    }

    function test_ResolveAfterReclaimIsRejected() public {
        // A backend coming back online after the window must not be able to settle a
        // duel whose stakes have already gone home.
        _openAndAccept();
        vm.warp(block.timestamp + duel.RESOLVE_WINDOW());
        duel.reclaim(DUEL);

        vm.expectRevert(ValorDuel.DuelNotAccepted.selector);
        vm.prank(resolver);
        duel.resolve(DUEL, alice);
    }

    function test_AbandonmentIsSurvivable_EveryStakeIsRecoverable() public {
        // The claim in the contract doc: if Valor disappeared, every SCRP in here
        // could still be retrieved by the people who put it in. Three duels in three
        // different states, settled by nobody, with the resolver key thrown away.
        bytes32 a = keccak256("a");
        bytes32 b = keccak256("b");
        _open(a, STAKE);                    // open, never accepted
        _open(b, 500e18);                   // will be accepted
        _accept(b, 500e18);
        // `_open` always stakes alice; b's opponent is bob.

        uint256 held = scrip.balanceOf(address(duel));
        assertGt(held, 0);

        vm.warp(block.timestamp + duel.OPEN_WINDOW());
        vm.startPrank(rando);
        duel.reclaim(a);
        duel.reclaim(b);
        vm.stopPrank();

        assertEq(scrip.balanceOf(address(duel)), 0, "nothing is stranded");
        assertEq(scrip.balanceOf(alice), 10_000e18);
        assertEq(scrip.balanceOf(bob), 10_000e18);
    }

    // ── lifecycle rules ───────────────────────────────────────────────────────

    function test_CannotOpenTheSameDuelIdTwice() public {
        _open(DUEL, STAKE);

        // Signed and hoisted before `expectRevert`, because `_permitSig` reads the
        // token and `expectRevert` binds to the very next external call.
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(aliceKey, address(duel), STAKE, deadline);
        vm.prank(resolver);
        vm.expectRevert(ValorDuel.DuelExists.selector);
        duel.openWithPermit(DUEL, alice, STAKE, deadline, v, r, s);
    }

    function test_CannotAcceptYourOwnDuel() public {
        _open(DUEL, STAKE);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(aliceKey, address(duel), STAKE, deadline);
        vm.expectRevert(ValorDuel.CannotDuelYourself.selector);
        vm.prank(resolver);
        duel.acceptWithPermit(DUEL, alice, deadline, v, r, s);
    }

    function test_TheOpponentStakesExactlyWhatTheChallengerDid() public {
        // The opponent's amount comes from storage, never from the caller, so there is
        // no path where one side is in for more than the other.
        _openAndAccept();
        (,, uint128 stake,,,) = duel.duels(DUEL);
        assertEq(uint256(stake), STAKE);
        assertEq(scrip.balanceOf(address(duel)), STAKE * 2);
    }

    function test_CannotAcceptATwiceAcceptedDuel() public {
        _openAndAccept();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(bobKey, address(duel), STAKE, deadline);
        vm.expectRevert(ValorDuel.DuelNotOpen.selector);
        vm.prank(resolver);
        duel.acceptWithPermit(DUEL, bob, deadline, v, r, s);
    }

    function test_ChallengerCanCancelWithoutTheBackend() public {
        _open(DUEL, STAKE);
        vm.prank(alice);
        duel.cancel(DUEL);
        assertEq(scrip.balanceOf(alice), 10_000e18, "full refund, no cut");
    }

    function test_AStrangerCannotCancelYourDuel() public {
        _open(DUEL, STAKE);
        vm.expectRevert(ValorDuel.NotChallenger.selector);
        vm.prank(rando);
        duel.cancel(DUEL);
    }

    function test_CannotCancelOnceAccepted() public {
        _openAndAccept();
        vm.expectRevert(ValorDuel.DuelNotOpen.selector);
        vm.prank(alice);
        duel.cancel(DUEL);
    }

    function test_ZeroStakeIsRejected() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(aliceKey, address(duel), 0, deadline);
        vm.expectRevert(ValorDuel.ZeroStake.selector);
        vm.prank(resolver);
        duel.openWithPermit(DUEL, alice, 0, deadline, v, r, s);
    }

    // ── administration ────────────────────────────────────────────────────────

    function test_TheCutIsCappedEvenForTheOwner() public {
        uint16 tooHigh = duel.MAX_HOUSE_CUT_BPS() + 1; // read before expectRevert binds
        vm.prank(owner);
        vm.expectRevert(ValorDuel.CutTooHigh.selector);
        duel.setHouseCutBps(tooHigh);
    }

    function test_InitializeRejectsAnAbusiveCut() public {
        ValorDuel impl = new ValorDuel();
        vm.expectRevert(ValorDuel.CutTooHigh.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ValorDuel.initialize, (address(scrip), resolver, owner, 5_000))
        );
    }

    /// An escrow whose logic contract anyone can seize is not an escrow: the
    /// implementation is what every proxy delegates to.
    function test_ImplementationCannotBeInitialised() public {
        ValorDuel impl = new ValorDuel();
        vm.expectRevert();
        impl.initialize(address(scrip), resolver, owner, CUT_BPS);
    }

    /// Upgrading is the owner\'s right and nobody else\'s. The resolver settles
    /// duels from a hot key on a server; letting it swap the escrow logic would
    /// hand that key everything the multisig exists to keep away from it.
    function test_OnlyTheOwnerCanUpgrade() public {
        ValorDuel next = new ValorDuel();

        vm.expectRevert();
        vm.prank(resolver);
        duel.upgradeToAndCall(address(next), "");

        vm.expectRevert();
        vm.prank(rando);
        duel.upgradeToAndCall(address(next), "");

        vm.prank(owner);
        duel.upgradeToAndCall(address(next), "");
    }

    /// An upgrade must not disturb live escrow or the duel it belongs to.
    function test_EscrowSurvivesAnUpgrade() public {
        _openAndAccept();
        uint256 held = scrip.balanceOf(address(duel));

        ValorDuel next = new ValorDuel();
        vm.prank(owner);
        duel.upgradeToAndCall(address(next), "");

        assertEq(scrip.balanceOf(address(duel)), held, "escrow moved during an upgrade");
        (address challenger,, uint128 stake, ValorDuel.Status status,,) = duel.duels(DUEL);
        assertEq(challenger, alice);
        assertEq(uint256(stake), STAKE);
        assertEq(uint8(status), uint8(ValorDuel.Status.Accepted));

        // And it still settles afterwards.
        vm.prank(resolver);
        duel.resolve(DUEL, alice);
        assertEq(duel.escrowedBalance(), 0);
    }

    /// Rotating the key is only worth anything if the retired one stops working —
    /// including for opening duels, not just settling them.
    function test_RotatingTheResolverRetiresTheOldKey() public {
        address newRelay = makeAddr("newRelay");
        vm.prank(owner);
        duel.setResolver(newRelay);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(aliceKey, address(duel), STAKE, deadline);

        vm.prank(resolver);
        vm.expectRevert(ValorDuel.NotResolver.selector);
        duel.openWithPermit(DUEL, alice, STAKE, deadline, v, r, s);

        vm.prank(newRelay);
        duel.openWithPermit(DUEL, alice, STAKE, deadline, v, r, s);
        assertEq(scrip.balanceOf(address(duel)), STAKE);
    }

    function test_TheOldResolverCannotSettleAfterRotation() public {
        _openAndAccept();
        address newRelay = makeAddr("newRelay");
        vm.prank(owner);
        duel.setResolver(newRelay);

        vm.expectRevert(ValorDuel.NotResolver.selector);
        vm.prank(resolver);
        duel.resolve(DUEL, alice);

        vm.prank(newRelay);
        duel.resolve(DUEL, alice);
    }

    function test_OnlyOwnerAdministers() public {
        vm.expectRevert();
        vm.prank(rando);
        duel.setResolver(rando);

        vm.expectRevert();
        vm.prank(rando);
        duel.setHouseCutBps(0);
    }

    // ── invariants worth sweeping ─────────────────────────────────────────────

    function testFuzz_TheHouseNeverPaysOutMoreThanThePot(uint96 stake, uint16 bps) public {
        stake = uint96(bound(stake, 1e18, 1_000_000e18));
        bps = uint16(bound(bps, 0, duel.MAX_HOUSE_CUT_BPS()));
        vm.prank(owner);
        duel.setHouseCutBps(bps);

        uint256 pot = uint256(stake) * 2;
        assertLe(duel.winnerPayout(stake), pot, "a winner can never take more than both stakes");
    }

    function testFuzz_EscrowAlwaysCoversEveryLiveStake(uint96 stake) public {
        stake = uint96(bound(stake, 1e18, 5_000e18));
        scrip.mint(alice, uint256(stake));
        scrip.mint(bob, uint256(stake));

        _open(DUEL, stake);
        _accept(DUEL, stake);
        assertGe(duel.escrowedBalance(), uint256(stake) * 2);
    }

    /// Deploy ValorDuel the way production does: implementation plus ERC1967 proxy.
    function _deployDuel(address scrip_, address resolver_, address owner_, uint16 cut)
        internal
        returns (ValorDuel)
    {
        ValorDuel impl = new ValorDuel();
        return ValorDuel(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(ValorDuel.initialize, (scrip_, resolver_, owner_, cut))
        )));
    }
}
