// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ValorDuel — staked player-versus-player escrow in Scrip, on Avalanche C-Chain
/// @notice Two players stake the same amount of SCRP on the same seeded run. The
///         higher server-validated score takes the pot minus a house cut. This
///         contract holds the stakes for the duration and pays out the result.
///
/// @dev WHY THIS CONTRACT EXISTS AT ALL
///      Valor already runs staked duels on Celo (see apps/api/src/handlers/duels.rs),
///      where stakes are escrowed by moving G$ into the ValorRewardPool and paid out
///      by the backend calling `distributeReward`. That works, but it means player
///      money sits in a pool the operator controls, and the operator is the only
///      thing standing between a player and their stake.
///
///      On Avalanche the duel IS the product rather than a side mode, so the escrow
///      is its own contract with three properties the pool rail does not have:
///
///        1. The stake is held by code, not by an operator wallet.
///        2. The resolver can choose the WINNER but can never choose the RECIPIENT.
///           `resolve` pays `challenger` or `opponent` and reverts on anything else,
///           so a fully compromised backend key can rig a match and still cannot
///           move a single SCRP to an address outside the duel.
///        3. If the backend never resolves, `reclaim` refunds both sides in full,
///           permissionlessly, after a fixed window. Nobody's stake depends on us
///           staying online, staying solvent, or staying honest.
///
/// @dev UPGRADEABLE, AND WHAT THAT COSTS
///      This was originally written immutable, on the argument that a contract whose
///      promise is "we cannot touch your escrowed stake" should not also be able to
///      rewrite its own rules. It is now a UUPS proxy, for consistency with every
///      other Valor contract and so a bug in an escrow holding player money can be
///      fixed rather than only drained.
///
///      That is a real trade and it should be stated plainly rather than glossed:
///      whoever holds the upgrade key CAN replace this logic with logic that moves
///      escrowed stakes anywhere. The three properties below are guarantees of the
///      current code, not of the address. What protects them is that
///      `_authorizeUpgrade` is `onlyOwner` and the owner is a Safe multisig, so
///      changing them requires several people to sign something publicly visible on
///      chain — not one compromised server key.
///
///      `reclaim` still matters and is still the strongest single line of defence:
///      it needs no key at all, so a project that simply stops running cannot strand
///      anyone's stake. Adding a timelock to the upgrade path is the obvious next
///      hardening step and is deliberately left as a follow-up rather than pretended
///      at here.
///
/// @dev WHY THE OWNER AND THE RESOLVER ARE DIFFERENT ADDRESSES
///      The resolver is the backend relay, which is a hot key on a server signing
///      automated transactions. The owner should be a cold wallet or a Safe. Owner
///      can rotate the resolver and withdraw accrued house cut; it cannot touch a
///      live escrow. Resolver can settle duels; it cannot withdraw revenue, change
///      the cut, or point payouts anywhere. Neither role alone can take player funds.
contract ValorDuel is ReentrancyGuard, OwnableUpgradeable, UUPSUpgradeable {
    /// @notice The staked token. Scrip on C-Chain.
    /// @dev    Set once at initialisation and never given a setter: a duel escrow
    ///         that can switch out the asset it is holding mid-duel is not an
    ///         escrow. (An upgrade could still change it, which is the cost noted
    ///         above. The absence of a setter means it cannot happen by accident.)
    IERC20 public scrip;

    /// @notice Backend key allowed to settle duels. Never holds funds.
    address public resolver;

    /// @notice House cut on a decided duel, in basis points (1 bp = 0.01%).
    /// @dev    Basis points rather than percent because the launch rate is 0.5%,
    ///         which no integer percent can express. Mirrors HOUSE_CUT_BPS in the
    ///         Celo duel handler so both chains charge players the same rate.
    uint16 public houseCutBps;

    /// @notice Hard ceiling on the cut, enforced at construction and on every change.
    ///         The owner can tune the rate but can never make duels predatory.
    uint16 public constant MAX_HOUSE_CUT_BPS = 1_000; // 10%

    /// @notice How long an accepted duel may stay unresolved before either side can
    ///         take their stake back.
    /// @dev    Generous on purpose. A real duel resolves in minutes, so this window
    ///         is not a gameplay parameter; it is the deadline after which the
    ///         operator's cooperation stops being required. Long enough that a
    ///         routine backend outage does not start refunding live duels, short
    ///         enough that a player is never left waiting on us for long.
    uint256 public constant RESOLVE_WINDOW = 24 hours;

    /// @notice How long an unaccepted duel sits before its stake can be reclaimed.
    uint256 public constant OPEN_WINDOW = 7 days;

    /// @notice House cut accrued and not yet withdrawn. Tracked rather than inferred
    ///         from the balance, because the balance also contains live escrow and
    ///         paying revenue out of escrowed stakes is the one bug that must be
    ///         impossible here.
    uint256 public accumulatedRevenue;

    enum Status {
        None,      // never opened
        Open,      // challenger staked, waiting for an opponent
        Accepted,  // both staked, both playing
        Resolved,  // paid out
        Cancelled, // refunded before it started
        Reclaimed  // refunded via the timeout escape hatch
    }

    struct Duel {
        address challenger;
        address opponent;
        uint128 stake;      // per side, in SCRP wei
        Status  status;
        uint64  openedAt;
        uint64  acceptedAt;
    }

    /// @notice duelId => duel. The id is chosen by the backend (the UUID of the row
    ///         in `duels`), so one identifier ties the database, the API and the
    ///         chain together with no lookup table in between.
    mapping(bytes32 => Duel) public duels;

    event DuelOpened(bytes32 indexed duelId, address indexed challenger, uint256 stake);
    event DuelAccepted(bytes32 indexed duelId, address indexed opponent, uint256 stake);
    event DuelResolved(bytes32 indexed duelId, address indexed winner, uint256 payout, uint256 houseCut);
    event DuelDrawn(bytes32 indexed duelId, uint256 refundEach);
    event DuelCancelled(bytes32 indexed duelId, address indexed challenger, uint256 refund);
    event DuelReclaimed(bytes32 indexed duelId, uint256 refundEach);
    event ResolverSet(address indexed resolver);
    event HouseCutSet(uint16 bps);
    event RevenueWithdrawn(address indexed to, uint256 amount);

    error NotResolver();
    error DuelExists();
    error DuelNotOpen();
    error DuelNotAccepted();
    error CannotDuelYourself();
    error WinnerNotInDuel();
    error ZeroStake();
    error ZeroAddress();
    error CutTooHigh();
    error TooEarlyToReclaim();
    error NotChallenger();

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param scrip_    The Scrip token.
    /// @param resolver_ Backend relay allowed to settle duels.
    /// @param owner_    Safe multisig. Must NOT equal `resolver_`: the owner holds
    ///                  the upgrade key, and handing that to the server key would
    ///                  undo every guarantee documented above.
    function initialize(address scrip_, address resolver_, address owner_, uint16 houseCutBps_)
        public
        initializer
    {
        if (scrip_ == address(0) || resolver_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (houseCutBps_ > MAX_HOUSE_CUT_BPS) revert CutTooHigh();
        __Ownable_init(owner_);
        scrip = IERC20(scrip_);
        resolver = resolver_;
        houseCutBps = houseCutBps_;
        emit ResolverSet(resolver_);
        emit HouseCutSet(houseCutBps_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Staking ───────────────────────────────────────────────────────────────

    /// @notice Open a duel, pulling the challenger's stake in via a signed permit.
    /// @dev    Relayed by the backend so the player spends no AVAX. The permit is for
    ///         exactly `stake`, which is why the amount is a parameter rather than
    ///         read from anywhere: the signature the player produced commits to it,
    ///         and a mismatch reverts inside `permit` rather than moving the wrong sum.
    ///
    ///         The permit is consumed in a try/catch because a front-run of the same
    ///         signature would otherwise revert the whole call. If the allowance is
    ///         already in place the transfer below succeeds regardless, which is the
    ///         only thing that actually matters.
    function openWithPermit(
        bytes32 duelId,
        address challenger,
        uint256 stake,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyResolver nonReentrant {
        if (stake == 0) revert ZeroStake();
        if (challenger == address(0)) revert ZeroAddress();
        if (duels[duelId].status != Status.None) revert DuelExists();

        _permit(challenger, stake, deadline, v, r, s);

        duels[duelId] = Duel({
            challenger: challenger,
            opponent:   address(0),
            stake:      uint128(stake),
            status:     Status.Open,
            openedAt:   uint64(block.timestamp),
            acceptedAt: 0
        });

        // Interaction last: state is already consistent if the token misbehaves.
        _pull(challenger, stake);
        emit DuelOpened(duelId, challenger, stake);
    }

    /// @notice Match an open duel, staking the same amount as the challenger.
    /// @dev    The stake is read from storage rather than taken as a parameter, so an
    ///         opponent can never be signed up for a different number than the one
    ///         the challenger put down. That symmetry is the whole premise of the mode.
    function acceptWithPermit(
        bytes32 duelId,
        address opponent,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyResolver nonReentrant {
        Duel storage d = duels[duelId];
        if (d.status != Status.Open) revert DuelNotOpen();
        if (opponent == address(0)) revert ZeroAddress();
        if (opponent == d.challenger) revert CannotDuelYourself();

        uint256 stake = d.stake;
        _permit(opponent, stake, deadline, v, r, s);

        d.opponent   = opponent;
        d.status     = Status.Accepted;
        d.acceptedAt = uint64(block.timestamp);

        _pull(opponent, stake);
        emit DuelAccepted(duelId, opponent, stake);
    }

    // ── Settlement ────────────────────────────────────────────────────────────

    /// @notice Settle a played duel in favour of one of its two participants.
    /// @dev    `winner` is checked against the duel's own two addresses. This single
    ///         requirement is what bounds the damage from a stolen resolver key: the
    ///         holder can decide who wins, which is bad, but cannot direct the pot to
    ///         an address of their choosing, which would be fatal.
    function resolve(bytes32 duelId, address winner) external onlyResolver nonReentrant {
        Duel storage d = duels[duelId];
        if (d.status != Status.Accepted) revert DuelNotAccepted();
        if (winner != d.challenger && winner != d.opponent) revert WinnerNotInDuel();

        uint256 pot = uint256(d.stake) * 2;
        uint256 cut = (pot * houseCutBps) / 10_000;
        uint256 take = pot - cut;

        d.status = Status.Resolved;
        accumulatedRevenue += cut;

        scrip.transfer(winner, take);
        emit DuelResolved(duelId, winner, take, cut);
    }

    /// @notice Settle a tie: both stakes returned, no cut taken.
    /// @dev    Charging a fee on a duel nobody won would be the house billing for a
    ///         non-result. Matches the Celo handler, which refunds draws in full.
    function resolveDraw(bytes32 duelId) external onlyResolver nonReentrant {
        Duel storage d = duels[duelId];
        if (d.status != Status.Accepted) revert DuelNotAccepted();

        uint256 stake = d.stake;
        d.status = Status.Resolved;

        scrip.transfer(d.challenger, stake);
        scrip.transfer(d.opponent, stake);
        emit DuelDrawn(duelId, stake);
    }

    /// @notice Withdraw an unaccepted duel and take the stake back.
    /// @dev    Callable by the challenger directly as well as by the resolver, so
    ///         getting your own money out of a duel nobody joined never requires the
    ///         backend to be up.
    function cancel(bytes32 duelId) external nonReentrant {
        Duel storage d = duels[duelId];
        if (d.status != Status.Open) revert DuelNotOpen();
        if (msg.sender != d.challenger && msg.sender != resolver) revert NotChallenger();

        uint256 stake = d.stake;
        address challenger = d.challenger;
        d.status = Status.Cancelled;

        scrip.transfer(challenger, stake);
        emit DuelCancelled(duelId, challenger, stake);
    }

    // ── The escape hatch ──────────────────────────────────────────────────────

    /// @notice Refund a duel the operator failed to settle. Permissionless.
    ///
    /// @dev    THIS IS THE FUNCTION THAT MAKES THE ESCROW TRUSTWORTHY. Everything
    ///         else here requires Valor to be running. This does not: anyone can call
    ///         it, for anyone's duel, once the window has passed, and it always
    ///         returns each side exactly what they put in with no cut taken. If this
    ///         project were abandoned tomorrow, every SCRP held by this contract
    ///         would still be recoverable by the people who staked it.
    ///
    ///         No cut on a reclaim: the house is being paid to settle duels, and a
    ///         duel that reached this path is one it did not settle.
    function reclaim(bytes32 duelId) external nonReentrant {
        Duel storage d = duels[duelId];
        uint256 stake = d.stake;

        if (d.status == Status.Accepted) {
            if (block.timestamp < uint256(d.acceptedAt) + RESOLVE_WINDOW) revert TooEarlyToReclaim();
            address challenger = d.challenger;
            address opponent = d.opponent;
            d.status = Status.Reclaimed;

            scrip.transfer(challenger, stake);
            scrip.transfer(opponent, stake);
            emit DuelReclaimed(duelId, stake);
        } else if (d.status == Status.Open) {
            if (block.timestamp < uint256(d.openedAt) + OPEN_WINDOW) revert TooEarlyToReclaim();
            address challenger = d.challenger;
            d.status = Status.Reclaimed;

            scrip.transfer(challenger, stake);
            emit DuelReclaimed(duelId, stake);
        } else {
            revert DuelNotAccepted();
        }
    }

    // ── Administration ────────────────────────────────────────────────────────

    /// @notice Point settlement at a new backend key. The reason the resolver is a
    ///         variable and not an immutable: rotating a suspected-compromised server
    ///         key must not require redeploying the contract that holds live escrow.
    function setResolver(address resolver_) external onlyOwner {
        if (resolver_ == address(0)) revert ZeroAddress();
        resolver = resolver_;
        emit ResolverSet(resolver_);
    }

    function setHouseCutBps(uint16 bps) external onlyOwner {
        if (bps > MAX_HOUSE_CUT_BPS) revert CutTooHigh();
        houseCutBps = bps;
        emit HouseCutSet(bps);
    }

    /// @notice Withdraw accrued house cut.
    /// @dev    Pays from `accumulatedRevenue` only, never from the contract balance.
    ///         The distinction is the entire safety property: escrowed stakes and
    ///         earned revenue share an address, and only one of them belongs to us.
    function withdrawRevenue(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = accumulatedRevenue;
        accumulatedRevenue = 0;
        scrip.transfer(to, amount);
        emit RevenueWithdrawn(to, amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /// @notice What a winner would receive from a duel at `stake` per side.
    ///         Exposed so the UI and the API quote the same number the contract pays.
    function winnerPayout(uint256 stake) external view returns (uint256) {
        uint256 pot = stake * 2;
        return pot - (pot * houseCutBps) / 10_000;
    }

    /// @notice SCRP currently held on behalf of players, as opposed to earned.
    ///         `balanceOf(this) - accumulatedRevenue`. A reviewer can check this
    ///         against the sum of live duels at any block.
    function escrowedBalance() external view returns (uint256) {
        return scrip.balanceOf(address(this)) - accumulatedRevenue;
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    /// @dev Consume an EIP-2612 permit, tolerating one that has already been used.
    ///      A permit can be front-run by anyone who observes it, which would revert
    ///      this call for a signature that had already done its job. What matters is
    ///      the allowance being in place, so a failed permit is only fatal if the
    ///      subsequent transferFrom also fails, and that is checked where it belongs.
    function _permit(address owner_, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) private {
        try IERC20Permit(address(scrip)).permit(owner_, address(this), value, deadline, v, r, s) {} catch {}
    }

    function _pull(address from, uint256 amount) private {
        bool ok = scrip.transferFrom(from, address(this), amount);
        require(ok, "SCRP transferFrom failed");
    }

    /// @dev Reserved storage so a future upgrade can add state without colliding
    ///      with whatever a later version puts here.
    uint256[45] private __gap;
}
