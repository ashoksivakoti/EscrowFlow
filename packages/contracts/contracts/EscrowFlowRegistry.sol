// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC1271 {
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view returns (bytes4 magicValue);
}

/**
 * @title EscrowFlowRegistry
 * @author EscrowFlow
 * @notice Multi-project ERC20 milestone escrow with milestone submission, approval, payout,
 *  per-milestone disputes, and admin emergency settlement controls.
 * @dev Core model:
 *  - Funds are deposited per project and tracked through funded/released/refunded accounting.
 *  - Disputed milestone amounts are reserved to prevent concurrent over-allocation.
 *  - Admin emergency settlement is timelock-gated and can run while paused.
 *
 * Invariants:
 *  - For each project: releasedAmount + refundedAmount <= fundedAmount.
 *  - For each token: _tokenOutstanding equals aggregate unsettled escrow liability.
 *  - For each project: reservedAmount equals active disputed milestone allocations.
 *  - settledMilestoneCount <= milestoneCount.
 */
contract EscrowFlowRegistry is AccessControl {
    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");

    // -------------------------------------------------------------------------
    // Limits
    // -------------------------------------------------------------------------

    uint256 public constant MAX_MILESTONES = 50;
    uint256 public constant MAX_URI_BYTES = 2048;
    uint256 public constant DISPUTE_TIMEOUT = 30 days;
    uint256 public constant ALTERNATIVE_RECIPIENT_DELAY = 48 hours;

    uint256 public constant CANCEL_TIMEOUT = 14 days;

    uint256 public constant EMERGENCY_RESOLUTION_DELAY = 1 days;
    uint256 private constant _PROJECT_WIDE_RECIPIENT_SCOPE = type(uint256).max;
    bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
    bytes32 private constant _SET_ALT_RECIPIENT_TYPEHASH =
        keccak256(
            "SetAlternativeRecipient(uint256 projectId,uint256 milestoneIndex,bool isFreelancer,address originalParty,address newRecipient,uint256 nonce,uint256 deadline)"
        );
    uint256 private constant _SECP256K1N_DIV_2 =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes4 private constant EIP1271_MAGIC_VALUE = 0x1626ba7e;

    /// @dev Arbitrator / emergency action ID domains (bytes32, not string, to shrink bytecode).
    bytes32 private constant _ACTION_DOMAIN_SET_ALT_RECIPIENT =
        keccak256("SET_ALT_RECIPIENT");
    bytes32 private constant _ACTION_DOMAIN_RESOLVE_DISPUTE =
        keccak256("RESOLVE_DISPUTE");
    bytes32 private constant _ACTION_DOMAIN_EMERGENCY_RESOLVE =
        keccak256("EMERGENCY_RESOLVE");

    bool private _paused;
    uint256 private _reentrancyStatus = 1;

    modifier whenNotPaused() {
        if (_paused) revert EnforcedPause();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus != 1) revert ReentrancyGuardReentrantCall();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    enum ProjectStatus {
        Active,
        Disputed,
        Completed,
        Cancelled
    }

    enum MilestoneStatus {
        Pending,
        Submitted,
        Approved,
        Released,
        Refunded
    }

    enum DisputeResolutionKind {
        ReleaseToFreelancer,
        RefundToClient,
        Split
    }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct MilestoneInput {
        uint256 amount;
        uint64 deadline;
    }

    struct Milestone {
        uint256 amount;
        uint64 deadline;
        uint64 reviewEnteredAt;
        MilestoneStatus status;
        string submissionURI;
    }

    struct Project {
        address client;
        address freelancer;
        address token;
        uint256 totalAmount;
        uint256 fundedAmount;
        uint256 releasedAmount;
        uint256 refundedAmount;
        uint256 reservedAmount;
        uint256 activeDisputeCount;
        uint256 settledMilestoneCount;
        string metadataURI;
        ProjectStatus status;
        uint256 milestoneCount;
    }

    struct MilestoneDispute {
        bool active;
        address raisedBy;
        uint64 raisedAt;
        string reasonURI;
        string lastAppendedEvidenceURI;
    }

    struct PendingAlternativeRecipient {
        address recipient;
        uint64 executableAfter;
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    uint256 private _projectCount;

    mapping(uint256 projectId => Project project) private _projects;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => Milestone milestone))
        private _milestones;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => MilestoneDispute dispute))
        private _disputes;
    mapping(address token => bool allowed) private _allowedTokens;
    mapping(address token => bool reviewed) private _tokenReviewAttested;
    mapping(address token => uint256 outstanding) private _tokenOutstanding;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => address recipient))
        private _alternativeFreelancerRecipient;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => address recipient))
        private _alternativeClientRecipient;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => PendingAlternativeRecipient pending))
        private _pendingAlternativeFreelancerRecipient;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => PendingAlternativeRecipient pending))
        private _pendingAlternativeClientRecipient;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => address recipient))
        private _partyAuthorizedFreelancerRecipient;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => address recipient))
        private _partyAuthorizedClientRecipient;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => mapping(bool isFreelancer => uint256 nonce)))
        private _partyRecipientAuthorizationNonce;
    bytes32 private immutable _domainSeparator;

    uint256 private _arbitratorCount;
    uint256 private _arbitratorThreshold = 1;
    uint256 private _arbitratorConfigNonce;
    mapping(bytes32 actionId => uint256 approvals)
        private _arbitratorActionApprovals;
    mapping(bytes32 actionId => bool executed)
        private _arbitratorActionExecuted;
    mapping(bytes32 actionId => mapping(address arbitrator => bool approved))
        private _arbitratorActionApprovedBy;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => uint256 nonce))
        private _arbitratorActionNonce;
    mapping(uint256 projectId => mapping(uint256 milestoneIndex => uint256 nonce))
        private _emergencyResolveNonce;

    mapping(bytes32 actionHash => uint64 readyAt)
        private _emergencyResolveReadyAt;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed client,
        address indexed freelancer,
        address token,
        uint256 totalAmount,
        string metadataURI,
        uint256 milestoneCount
    );
    event ProjectFunded(
        uint256 indexed projectId,
        address indexed client,
        address indexed token,
        uint256 amount,
        uint256 fundedAmountAfter
    );
    event MilestoneSubmitted(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed freelancer,
        string submissionURI
    );
    event MilestoneApproved(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed client
    );
    /// @notice Emitted when milestone funds are released.
    /// @dev `recipient` is the actual payout destination and may differ from
    /// `freelancer` when an alternative recipient is configured.
    event MilestoneFundsReleased(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed recipient,
        address freelancer,
        address token,
        uint256 amount,
        uint256 releasedAmountAfter
    );
    event DisputeRaised(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed raisedBy,
        address token,
        uint8 milestoneStatus,
        string reasonURI
    );
    event DisputeEvidenceAppended(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed submittedBy,
        string evidenceURI
    );
    event DisputeResolved(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed resolver,
        uint8 resolutionKind,
        uint256 freelancerAmount,
        uint256 clientAmount
    );
    event DisputePayoutRecipients(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address freelancerRecipient,
        address clientRecipient
    );
    event TokenReviewAttested(address indexed token, address indexed admin);
    event AllowedTokenUpdated(address indexed token, bool allowed);
    event ProjectCancelled(
        uint256 indexed projectId,
        address indexed client,
        address indexed token,
        uint256 refundedAmount
    );
    event ProjectEmergencyCancelled(
        uint256 indexed projectId,
        address indexed admin,
        address indexed token,
        uint256 refundedAmount
    );
    event EmergencyDisputeResolved(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed admin,
        uint8 resolutionKind,
        uint256 freelancerAmount,
        uint256 clientAmount
    );
    event EmergencyDisputeResolutionProposed(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed admin,
        bytes32 actionHash,
        uint8 resolutionKind,
        uint256 freelancerAmount,
        uint256 clientAmount,
        uint64 readyAt
    );
    event EmergencyDisputeResolutionCancelled(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed admin,
        bytes32 actionHash
    );
    event EmergencyDisputeResolutionNonceAdvanced(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        uint256 newNonce,
        address indexed advancedBy
    );
    event AlternativeRecipientSet(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        bool indexed isFreelancer,
        address recipient,
        uint256 executableAfter,
        address updatedBy
    );
    event AlternativeRecipientExecuted(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        bool indexed isFreelancer,
        address recipient,
        address executedBy
    );
    event ArbitratorThresholdUpdated(
        uint256 previousThreshold,
        uint256 newThreshold,
        address updatedBy
    );
    /// @notice Emitted when an arbitrator confirms a multisig action.
    /// @dev `threshold` reflects the threshold at vote time. If threshold or
    /// arbitrator configuration changes later, the actionId domain may change
    /// and invalidate this vote.
    event ArbitratorActionConfirmed(
        bytes32 indexed actionId,
        address indexed arbitrator,
        uint256 approvals,
        uint256 threshold
    );
    event Paused(address account);
    event Unpaused(address account);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error EnforcedPause();
    error ExpectedPause();
    error ReentrancyGuardReentrantCall();
    error TokenTransferFailed();

    error ZeroAddress();
    error InvalidToken();
    error ClientEqualsFreelancer();
    error InvalidMilestoneCount();
    error ZeroMilestoneAmount();
    error ZeroMilestoneDeadline();
    error TotalAmountOverflow();
    error ProjectNotFound();
    error NotProjectClient();
    error ProjectNotActive();
    error ZeroFundingAmount();
    error FundingExceedsTotal();
    error MilestoneIndexOutOfRange();
    error NotProjectFreelancer();
    error InvalidMilestoneStatus();
    error InsufficientFundingForMilestone();
    error DisputeAlreadyActive();
    error DisputeNotActive();
    error NotAuthorizedToRaiseDispute();
    error InvalidDisputeMilestoneStatus();
    error InvalidResolutionAmounts();
    error InvalidSplitAmounts();
    error InsufficientEscrowLiquidity();
    error DisputeActive();
    error URITooLong();
    error TokenNotAllowed();
    error TokenReviewNotAttested();
    error InvalidFundingTransfer();
    error MilestoneDeadlineNotReached();
    error InvalidRecipient();
    error InsufficientUntrackedBalance();
    error CannotCancelWithActiveDispute();
    error CannotCancelWithInReviewMilestone();
    error CannotCancelApprovedMilestone();
    error RoleSeparationViolation();
    error PendingDisputeMustRefundClient();
    error PreviousMilestoneNotCompleted();
    error DisputeTimeoutNotReached();
    error StaleDisputeTimeoutOnlyForPendingMilestone();
    error AlternativeRecipientChangePending();
    error AlternativeRecipientExecutionNotReady();
    error NotProjectParty();
    error InvalidArbitratorThreshold();
    error ArbitratorActionAlreadyExecuted();
    error MilestoneCountInvariantViolation();
    error InvalidPayoutTransfer();
    error EmergencyResolutionNotProposed();
    error EmergencyResolutionAlreadyProposed(uint64 readyAt);
    error EmergencyResolutionNotReady(uint64 readyAt);
    error InvalidSignature();
    error SignatureExpired();
    error InvalidAuthorizationNonce();
    error TimestampOverflow();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _domainSeparator = keccak256(
            abi.encode(
                _EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("EscrowFlowRegistry")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // Role management (with separation of duties)
    // -------------------------------------------------------------------------

    function grantRole(
        bytes32 role,
        address account
    ) public override onlyRole(getRoleAdmin(role)) {
        bool hadRole = hasRole(role, account);
        _enforceRoleSeparationOnGrant(role, account);
        super.grantRole(role, account);
        if (role == ARBITRATOR_ROLE && !hadRole) {
            _arbitratorCount += 1;
            _arbitratorConfigNonce += 1;
            if (_arbitratorCount == 1) {
                _arbitratorThreshold = 1;
            }
        }
        _assertRoleSeparationInvariant(account);
    }

    function revokeRole(
        bytes32 role,
        address account
    ) public override onlyRole(getRoleAdmin(role)) {
        bool hadRole = hasRole(role, account);
        super.revokeRole(role, account);
        if (role == ARBITRATOR_ROLE && hadRole) {
            _arbitratorCount -= 1;
            _arbitratorConfigNonce += 1;
            _normalizeArbitratorThreshold();
        }
        _assertRoleSeparationInvariant(account);
    }

    function renounceRole(
        bytes32 role,
        address callerConfirmation
    ) public override {
        bool hadRole = hasRole(role, callerConfirmation);
        super.renounceRole(role, callerConfirmation);
        if (role == ARBITRATOR_ROLE && hadRole) {
            _arbitratorCount -= 1;
            _arbitratorConfigNonce += 1;
            uint256 previousThreshold = _arbitratorThreshold;
            if (_arbitratorCount == 0) {
                _arbitratorThreshold = 1;
            } else if (_arbitratorThreshold > _arbitratorCount) {
                _arbitratorThreshold = _arbitratorCount;
            }
            if (_arbitratorThreshold != previousThreshold) {
                emit ArbitratorThresholdUpdated(
                    previousThreshold,
                    _arbitratorThreshold,
                    msg.sender
                );
            }
        }
        _assertRoleSeparationInvariant(callerConfirmation);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function paused() external view returns (bool) {
        return _paused;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        if (_paused) revert EnforcedPause();
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        if (!_paused) revert ExpectedPause();
        _paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Records admin review attestation for allowlisting a token.
    function attestTokenReviewForAllowlist(
        address token
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        if (token.code.length == 0) revert InvalidToken();
        _tokenReviewAttested[token] = true;
        emit TokenReviewAttested(token, msg.sender);
    }

    /// @notice Allows or disallows an ERC20 token for new projects.
    /// @dev Only allowlist exact-transfer, non-rebasing, non-fee-on-transfer,
    /// and non-blacklisting-compatible tokens reviewed for this protocol.
    function setAllowedToken(
        address token,
        bool allowed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        if (token.code.length == 0) revert InvalidToken();
        if (allowed && !_tokenReviewAttested[token])
            revert TokenReviewNotAttested();
        _allowedTokens[token] = allowed;
        emit AllowedTokenUpdated(token, allowed);
    }

    /// @notice Sets or clears a party-authorized recipient using a signed consent.
    /// @dev milestoneIndex can be a concrete milestone id or `type(uint256).max`
    /// for project-wide fallback on normal client refund flows.
    function setPartyAuthorizedRecipientBySig(
        uint256 projectId,
        uint256 milestoneIndex,
        bool isFreelancer,
        address originalParty,
        address newRecipient,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        Project storage project_ = _projectStorage(projectId);
        if (
            milestoneIndex != _PROJECT_WIDE_RECIPIENT_SCOPE &&
            milestoneIndex >= project_.milestoneCount
        ) {
            revert MilestoneIndexOutOfRange();
        }
        address expectedParty = isFreelancer
            ? project_.freelancer
            : project_.client;
        if (originalParty != expectedParty) revert InvalidSignature();

        bytes32 structHash = keccak256(
            abi.encode(
                _SET_ALT_RECIPIENT_TYPEHASH,
                projectId,
                milestoneIndex,
                isFreelancer,
                originalParty,
                newRecipient,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator, structHash)
        );
        if (!_isValidPartySignature(originalParty, digest, signature)) {
            revert InvalidSignature();
        }

        _consumePartyRecipientAuthorizationNonce(
            projectId,
            milestoneIndex,
            isFreelancer,
            nonce
        );
        _setPartyAuthorizedRecipient(
            projectId,
            milestoneIndex,
            isFreelancer,
            newRecipient
        );

        emit AlternativeRecipientSet(
            projectId,
            milestoneIndex,
            isFreelancer,
            newRecipient,
            0,
            msg.sender
        );
    }

    /// @notice Sets or clears a party-authorized recipient via direct party call.
    /// @dev milestoneIndex can be a concrete milestone id or `type(uint256).max`
    /// for project-wide fallback on normal client refund flows.
    function setPartyAuthorizedRecipient(
        uint256 projectId,
        uint256 milestoneIndex,
        bool isFreelancer,
        address newRecipient
    ) external {
        Project storage project_ = _projectStorage(projectId);
        address expectedParty = isFreelancer
            ? project_.freelancer
            : project_.client;
        if (msg.sender != expectedParty) revert NotProjectParty();

        if (
            milestoneIndex != _PROJECT_WIDE_RECIPIENT_SCOPE &&
            milestoneIndex >= project_.milestoneCount
        ) {
            revert MilestoneIndexOutOfRange();
        }

        _setPartyAuthorizedRecipient(
            projectId,
            milestoneIndex,
            isFreelancer,
            newRecipient
        );

        emit AlternativeRecipientSet(
            projectId,
            milestoneIndex,
            isFreelancer,
            newRecipient,
            0,
            msg.sender
        );
    }

    /// @notice Updates arbitrator confirmations required for multisig actions.
    /// @notice Sets the arbitrator multisig threshold.
    /// @dev Changing threshold invalidates pending multisig vote sets because
    /// action IDs are threshold-domain-separated. In-flight actions must be
    /// re-voted under the new threshold.
    function setArbitratorThreshold(
        uint256 newThreshold
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newThreshold == 0 || newThreshold > _arbitratorCount)
            revert InvalidArbitratorThreshold();
        uint256 previousThreshold = _arbitratorThreshold;
        _arbitratorThreshold = newThreshold;
        if (newThreshold != previousThreshold) {
            _arbitratorConfigNonce += 1;
        }
        emit ArbitratorThresholdUpdated(
            previousThreshold,
            newThreshold,
            msg.sender
        );
    }

    /// @notice Sets or clears a delayed alternative payout recipient for one dispute leg.
    function setAlternativeRecipient(
        uint256 projectId,
        uint256 milestoneIndex,
        bool isFreelancer,
        address newRecipient
    ) external onlyRole(ARBITRATOR_ROLE) whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        _requireMilestoneIndex(project_, milestoneIndex);
        if (!_disputes[projectId][milestoneIndex].active)
            revert DisputeNotActive();
        if (newRecipient == address(this)) revert InvalidRecipient();

        MilestoneDispute storage dispute_ = _disputes[projectId][
            milestoneIndex
        ];
        bool isConfirmed = _confirmArbitratorAction(
            _setAlternativeRecipientActionId(
                projectId,
                milestoneIndex,
                isFreelancer,
                newRecipient,
                dispute_.raisedAt
            )
        );
        if (!isConfirmed) return;

        _arbitratorActionNonce[projectId][milestoneIndex] += 1;

        uint256 executableAfter = 0;
        if (newRecipient == address(0)) {
            _clearAlternativeRecipientLeg(
                projectId,
                milestoneIndex,
                isFreelancer
            );
        } else {
            executableAfter = block.timestamp + ALTERNATIVE_RECIPIENT_DELAY;
            PendingAlternativeRecipient
                memory pending = PendingAlternativeRecipient({
                    recipient: newRecipient,
                    executableAfter: _toUint64(executableAfter)
                });
            if (isFreelancer) {
                _pendingAlternativeFreelancerRecipient[projectId][
                    milestoneIndex
                ] = pending;
            } else {
                _pendingAlternativeClientRecipient[projectId][
                    milestoneIndex
                ] = pending;
            }
        }
        emit AlternativeRecipientSet(
            projectId,
            milestoneIndex,
            isFreelancer,
            newRecipient,
            executableAfter,
            msg.sender
        );
    }

    /// @notice Applies a pending alternative recipient after its delay elapses.
    function executeAlternativeRecipient(
        uint256 projectId,
        uint256 milestoneIndex,
        bool isFreelancer
    ) external {
        Project storage project_ = _projectStorage(projectId);
        _requireMilestoneIndex(project_, milestoneIndex);
        if (!_disputes[projectId][milestoneIndex].active)
            revert DisputeNotActive();

        PendingAlternativeRecipient storage pending = isFreelancer
            ? _pendingAlternativeFreelancerRecipient[projectId][milestoneIndex]
            : _pendingAlternativeClientRecipient[projectId][milestoneIndex];

        address recipient = pending.recipient;
        if (recipient == address(0))
            revert AlternativeRecipientExecutionNotReady();
        if (block.timestamp < pending.executableAfter)
            revert AlternativeRecipientExecutionNotReady();

        if (isFreelancer) {
            if (msg.sender != project_.freelancer) revert NotProjectParty();
            _alternativeFreelancerRecipient[projectId][
                milestoneIndex
            ] = recipient;
        } else {
            if (msg.sender != project_.client) revert NotProjectParty();
            _alternativeClientRecipient[projectId][milestoneIndex] = recipient;
        }

        delete pending.recipient;
        pending.executableAfter = 0;
        emit AlternativeRecipientExecuted(
            projectId,
            milestoneIndex,
            isFreelancer,
            recipient,
            msg.sender
        );
    }

    /// @notice Sweeps token balance that is above tracked escrow liabilities.
    function sweepUntrackedToken(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (to == address(this)) revert InvalidRecipient();
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 liabilities = _tokenOutstanding[token];
        if (balance < liabilities || balance - liabilities < amount)
            revert InsufficientUntrackedBalance();
        _erc20Transfer(token, to, amount);
        if (IERC20(token).balanceOf(address(this)) < liabilities)
            revert InsufficientUntrackedBalance();
    }

    /// @notice Cancels an active project and refunds remaining free liquidity to the client.
    function cancelProject(
        uint256 projectId
    ) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        if (project_.client != msg.sender) revert NotProjectClient();
        _requireProjectOperable(project_);

        uint256 n = project_.milestoneCount;
        for (uint256 i = 0; i < n; ) {
            MilestoneDispute storage dispute_ = _disputes[projectId][i];
            Milestone storage milestone_ = _milestones[projectId][i];

            if (dispute_.active) {
                // Only stale Pending disputes can be auto-closed here.
                // Disputes on delivered work must go through resolution paths.
                if (
                    milestone_.status != MilestoneStatus.Pending ||
                    block.timestamp <
                    uint256(dispute_.raisedAt) + CANCEL_TIMEOUT
                ) {
                    revert CannotCancelWithActiveDispute();
                }
                uint256 disputedAmount = milestone_.amount;
                _clearDispute(dispute_);
                _advanceEmergencyResolveNonce(projectId, i);
                project_.activeDisputeCount -= 1;
                project_.reservedAmount -= disputedAmount;
                milestone_.status = MilestoneStatus.Refunded;
                milestone_.reviewEnteredAt = 0;
                _markMilestoneSettled(project_);
                _clearAlternativeRecipients(projectId, i);
            } else if (milestone_.status == MilestoneStatus.Submitted) {
                if (
                    milestone_.reviewEnteredAt == 0 ||
                    block.timestamp <
                    uint256(milestone_.reviewEnteredAt) + CANCEL_TIMEOUT
                ) {
                    revert CannotCancelWithInReviewMilestone();
                }

                uint256 payout = milestone_.amount;
                if (_freeLiquidity(project_) < payout) {
                    revert InsufficientEscrowLiquidity();
                }
                _requireProjectCanSettleAmount(project_, payout);

                project_.releasedAmount += payout;
                _tokenOutstanding[project_.token] -= payout;

                milestone_.status = MilestoneStatus.Released;
                milestone_.reviewEnteredAt = 0;
                _markMilestoneSettled(project_);

                address freelancerRecipient = _freelancerRecipient(
                    projectId,
                    i,
                    project_
                );
                _safeTransferExact(
                    IERC20(project_.token),
                    freelancerRecipient,
                    payout
                );

                emit MilestoneFundsReleased(
                    projectId,
                    i,
                    freelancerRecipient,
                    project_.freelancer,
                    project_.token,
                    payout,
                    project_.releasedAmount
                );
            } else if (milestone_.status == MilestoneStatus.Approved) {
                // Approved means accepted work, so cancel cannot reclaim it.
                revert CannotCancelApprovedMilestone();
            } else if (milestone_.status == MilestoneStatus.Pending) {
                milestone_.status = MilestoneStatus.Refunded;
                _markMilestoneSettled(project_);
            }

            unchecked {
                ++i;
            }
        }

        _refreshProjectStatus(projectId, project_);
        uint256 refundable = _freeLiquidity(project_);
        project_.refundedAmount += refundable;
        _tokenOutstanding[project_.token] -= refundable;
        project_.status = ProjectStatus.Cancelled;

        address clientRecipient = _projectClientRecipient(projectId, project_);
        _safeTransferExact(IERC20(project_.token), clientRecipient, refundable);

        emit ProjectCancelled(
            projectId,
            msg.sender,
            project_.token,
            refundable
        );
    }

    /// @notice Admin fallback cancellation when disputes are already cleared.
    function emergencyAdminCancel(
        uint256 projectId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Project storage project_ = _projectStorage(projectId);
        _requireProjectOperable(project_);
        if (project_.activeDisputeCount > 0)
            revert CannotCancelWithActiveDispute();

        uint256 n = project_.milestoneCount;
        for (uint256 i = 0; i < n; ) {
            Milestone storage milestone_ = _milestones[projectId][i];
            MilestoneStatus s = milestone_.status;
            if (
                s == MilestoneStatus.Approved || s == MilestoneStatus.Submitted
            ) {
                revert CannotCancelApprovedMilestone();
            }
            if (s == MilestoneStatus.Pending) {
                milestone_.status = MilestoneStatus.Refunded;
                milestone_.reviewEnteredAt = 0;
                _markMilestoneSettled(project_);
            }
            unchecked {
                ++i;
            }
        }

        uint256 refundable = _freeLiquidity(project_);
        project_.refundedAmount += refundable;
        _tokenOutstanding[project_.token] -= refundable;
        project_.status = ProjectStatus.Cancelled;

        address clientRecipient = _projectClientRecipient(projectId, project_);
        _safeTransferExact(IERC20(project_.token), clientRecipient, refundable);

        emit ProjectEmergencyCancelled(
            projectId,
            msg.sender,
            project_.token,
            refundable
        );
    }

    /// @notice Proposes a timelocked admin dispute resolution.
    function proposeEmergencyResolveDispute(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        _validateEmergencyResolvePayload(
            projectId,
            milestoneIndex,
            kind,
            freelancerAmount,
            clientAmount
        );

        bytes32 actionHash = _emergencyResolveActionHash(
            projectId,
            milestoneIndex,
            kind,
            freelancerAmount,
            clientAmount
        );
        uint64 existingReadyAt = _emergencyResolveReadyAt[actionHash];
        if (existingReadyAt != 0)
            revert EmergencyResolutionAlreadyProposed(existingReadyAt);
        uint64 readyAt = _toUint64(
            block.timestamp + EMERGENCY_RESOLUTION_DELAY
        );
        _emergencyResolveReadyAt[actionHash] = readyAt;

        emit EmergencyDisputeResolutionProposed(
            projectId,
            milestoneIndex,
            msg.sender,
            actionHash,
            uint8(kind),
            freelancerAmount,
            clientAmount,
            readyAt
        );
    }

    /// @notice Cancels a pending emergency dispute-resolution proposal.
    function cancelEmergencyResolveDispute(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32 actionHash = _emergencyResolveActionHash(
            projectId,
            milestoneIndex,
            kind,
            freelancerAmount,
            clientAmount
        );
        if (_emergencyResolveReadyAt[actionHash] == 0)
            revert EmergencyResolutionNotProposed();
        delete _emergencyResolveReadyAt[actionHash];

        emit EmergencyDisputeResolutionCancelled(
            projectId,
            milestoneIndex,
            msg.sender,
            actionHash
        );
    }

    /// @notice Returns the execution timestamp for a matching emergency proposal.
    function getEmergencyResolutionReadyAt(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) external view returns (uint64) {
        return
            _emergencyResolveReadyAt[
                _emergencyResolveActionHash(
                    projectId,
                    milestoneIndex,
                    kind,
                    freelancerAmount,
                    clientAmount
                )
            ];
    }

    /// @notice Executes a timelocked emergency dispute resolution.
    function emergencyResolveDispute(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        {
            bytes32 actionHash = _emergencyResolveActionHash(
                projectId,
                milestoneIndex,
                kind,
                freelancerAmount,
                clientAmount
            );
            uint64 readyAt = _emergencyResolveReadyAt[actionHash];
            if (readyAt == 0) revert EmergencyResolutionNotProposed();
            if (block.timestamp < readyAt)
                revert EmergencyResolutionNotReady(readyAt);
        }

        (
            Project storage project_,
            Milestone storage milestone_,
            MilestoneDispute storage dispute_
        ) = _validateEmergencyResolvePayload(
                projectId,
                milestoneIndex,
                kind,
                freelancerAmount,
                clientAmount
            );

        uint256 totalOut = freelancerAmount + clientAmount;
        _requireProjectCanSettleAmount(project_, totalOut);

        // Consume proposal only after all pre-state-change checks pass.
        delete _emergencyResolveReadyAt[
            _emergencyResolveActionHash(
                projectId,
                milestoneIndex,
                kind,
                freelancerAmount,
                clientAmount
            )
        ];

        _clearDispute(dispute_);
        _advanceEmergencyResolveNonce(projectId, milestoneIndex);
        project_.activeDisputeCount -= 1;
        project_.reservedAmount -= milestone_.amount;
        project_.releasedAmount += freelancerAmount;
        project_.refundedAmount += clientAmount;
        _tokenOutstanding[project_.token] -= totalOut;

        if (kind == DisputeResolutionKind.RefundToClient) {
            milestone_.status = MilestoneStatus.Refunded;
        } else {
            milestone_.status = MilestoneStatus.Released;
        }
        milestone_.reviewEnteredAt = 0;

        _markMilestoneSettled(project_);
        _refreshProjectStatus(projectId, project_);

        address freelancerRecipient = _freelancerRecipient(
            projectId,
            milestoneIndex,
            project_
        );
        address clientRecipient = _clientRecipient(
            projectId,
            milestoneIndex,
            project_
        );
        IERC20 token_ = IERC20(project_.token);
        if (freelancerAmount > 0)
            _safeTransferExact(token_, freelancerRecipient, freelancerAmount);
        if (clientAmount > 0)
            _safeTransferExact(token_, clientRecipient, clientAmount);

        emit EmergencyDisputeResolved(
            projectId,
            milestoneIndex,
            msg.sender,
            uint8(kind),
            freelancerAmount,
            clientAmount
        );
        emit DisputePayoutRecipients(
            projectId,
            milestoneIndex,
            freelancerRecipient,
            clientRecipient
        );

        _arbitratorActionNonce[projectId][milestoneIndex] += 1;
        _clearAlternativeRecipients(projectId, milestoneIndex);
    }

    // -------------------------------------------------------------------------
    // Projects
    // -------------------------------------------------------------------------

    function createProject(
        address freelancer,
        address token,
        string calldata metadataURI,
        MilestoneInput[] calldata milestoneInputs
    ) external whenNotPaused returns (uint256 projectId) {
        if (freelancer == address(0) || token == address(0))
            revert ZeroAddress();
        if (token.code.length == 0) revert InvalidToken();
        if (!_allowedTokens[token]) revert TokenNotAllowed();
        if (freelancer == msg.sender) revert ClientEqualsFreelancer();
        _requireUriLength(metadataURI);

        uint256 n = milestoneInputs.length;
        if (n == 0 || n > MAX_MILESTONES) revert InvalidMilestoneCount();

        uint256 totalAmount;
        projectId = _projectCount + 1;

        for (uint256 i = 0; i < n; ) {
            MilestoneInput calldata input = milestoneInputs[i];
            if (input.amount == 0) revert ZeroMilestoneAmount();
            if (input.deadline == 0) revert ZeroMilestoneDeadline();
            if (type(uint256).max - totalAmount < input.amount)
                revert TotalAmountOverflow();
            totalAmount += input.amount;
            _milestones[projectId][i] = Milestone({
                amount: input.amount,
                deadline: input.deadline,
                reviewEnteredAt: 0,
                status: MilestoneStatus.Pending,
                submissionURI: ""
            });
            unchecked {
                ++i;
            }
        }

        _projects[projectId] = Project({
            client: msg.sender,
            freelancer: freelancer,
            token: token,
            totalAmount: totalAmount,
            fundedAmount: 0,
            releasedAmount: 0,
            refundedAmount: 0,
            reservedAmount: 0,
            activeDisputeCount: 0,
            settledMilestoneCount: 0,
            metadataURI: metadataURI,
            status: ProjectStatus.Active,
            milestoneCount: n
        });

        _projectCount = projectId;

        emit ProjectCreated(
            projectId,
            msg.sender,
            freelancer,
            token,
            totalAmount,
            metadataURI,
            n
        );
    }

    function fundProject(
        uint256 projectId,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        if (project_.client != msg.sender) revert NotProjectClient();
        _requireProjectOperable(project_);
        if (amount == 0) revert ZeroFundingAmount();
        if (project_.fundedAmount + amount > project_.totalAmount)
            revert FundingExceedsTotal();

        IERC20 token_ = IERC20(project_.token);
        uint256 beforeBal = token_.balanceOf(address(this));
        _erc20TransferFrom(project_.token, msg.sender, address(this), amount);
        uint256 received = token_.balanceOf(address(this)) - beforeBal;
        if (received != amount) revert InvalidFundingTransfer();

        project_.fundedAmount += amount;
        _tokenOutstanding[project_.token] += amount;

        emit ProjectFunded(
            projectId,
            msg.sender,
            project_.token,
            amount,
            project_.fundedAmount
        );
    }

    // -------------------------------------------------------------------------
    // Milestones
    // -------------------------------------------------------------------------

    /// @notice Submits deliverable evidence for a pending milestone.
    function submitMilestone(
        uint256 projectId,
        uint256 milestoneIndex,
        string calldata submissionURI
    ) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        if (project_.freelancer != msg.sender) revert NotProjectFreelancer();
        _requireProjectOperable(project_);
        _requireMilestoneIndex(project_, milestoneIndex);
        if (_isDisputeActive(projectId, milestoneIndex)) revert DisputeActive();
        _requireUriLength(submissionURI);

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status != MilestoneStatus.Pending)
            revert InvalidMilestoneStatus();
        _requirePreviousMilestonesCompleted(projectId, milestoneIndex);

        if (_freeLiquidity(project_) < milestone_.amount)
            revert InsufficientFundingForMilestone();

        milestone_.submissionURI = submissionURI;
        milestone_.status = MilestoneStatus.Submitted;
        if (milestone_.reviewEnteredAt == 0) {
            milestone_.reviewEnteredAt = _toUint64(block.timestamp);
        }

        emit MilestoneSubmitted(
            projectId,
            milestoneIndex,
            msg.sender,
            submissionURI
        );
    }

    /// @notice Approves a submitted milestone.
    function approveMilestone(
        uint256 projectId,
        uint256 milestoneIndex
    ) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        if (project_.client != msg.sender) revert NotProjectClient();
        _requireProjectOperable(project_);
        _requireMilestoneIndex(project_, milestoneIndex);
        if (_isDisputeActive(projectId, milestoneIndex)) revert DisputeActive();

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status != MilestoneStatus.Submitted)
            revert InvalidMilestoneStatus();
        _requirePreviousMilestonesCompleted(projectId, milestoneIndex);

        milestone_.status = MilestoneStatus.Approved;

        emit MilestoneApproved(projectId, milestoneIndex, msg.sender);
    }

    /// @notice Releases an approved milestone payout to the freelancer.
    function releaseMilestone(
        uint256 projectId,
        uint256 milestoneIndex
    ) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        if (project_.client != msg.sender) revert NotProjectClient();
        _requireProjectOperable(project_);
        _requireMilestoneIndex(project_, milestoneIndex);
        if (_isDisputeActive(projectId, milestoneIndex)) revert DisputeActive();

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status != MilestoneStatus.Approved)
            revert InvalidMilestoneStatus();
        _requirePreviousMilestonesCompleted(projectId, milestoneIndex);

        uint256 payout = milestone_.amount;
        if (_freeLiquidity(project_) < payout) {
            revert InsufficientEscrowLiquidity();
        }
        _requireProjectCanSettleAmount(project_, payout);

        project_.releasedAmount += payout;
        _tokenOutstanding[project_.token] -= payout;
        milestone_.status = MilestoneStatus.Released;
        milestone_.reviewEnteredAt = 0;
        _markMilestoneSettled(project_);
        _refreshProjectStatus(projectId, project_);

        address freelancerRecipient = _freelancerRecipient(
            projectId,
            milestoneIndex,
            project_
        );
        _safeTransferExact(IERC20(project_.token), freelancerRecipient, payout);

        emit MilestoneFundsReleased(
            projectId,
            milestoneIndex,
            freelancerRecipient,
            project_.freelancer,
            project_.token,
            payout,
            project_.releasedAmount
        );
    }

    // -------------------------------------------------------------------------
    // Disputes
    // -------------------------------------------------------------------------

    function appendDisputeEvidence(
        uint256 projectId,
        uint256 milestoneIndex,
        string calldata evidenceURI
    ) external nonReentrant {
        Project storage project_ = _projectStorage(projectId);
        if (msg.sender != project_.client && msg.sender != project_.freelancer)
            revert NotAuthorizedToRaiseDispute();
        _requireMilestoneIndex(project_, milestoneIndex);
        _requireUriLength(evidenceURI);
        MilestoneDispute storage dispute_ = _disputes[projectId][
            milestoneIndex
        ];
        if (!dispute_.active) revert DisputeNotActive();
        dispute_.lastAppendedEvidenceURI = evidenceURI;
        emit DisputeEvidenceAppended(
            projectId,
            milestoneIndex,
            msg.sender,
            evidenceURI
        );
    }

    /// @notice Opens a dispute for a pending, submitted, or approved milestone.
    function raiseDispute(
        uint256 projectId,
        uint256 milestoneIndex,
        string calldata reasonURI
    ) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        _requireProjectOperable(project_);
        _requireMilestoneIndex(project_, milestoneIndex);
        _requirePreviousMilestonesCompleted(projectId, milestoneIndex);
        _requireUriLength(reasonURI);

        MilestoneDispute storage dispute_ = _disputes[projectId][
            milestoneIndex
        ];
        if (dispute_.active) revert DisputeAlreadyActive();
        if (msg.sender != project_.client && msg.sender != project_.freelancer)
            revert NotAuthorizedToRaiseDispute();

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status == MilestoneStatus.Pending) {
            if (block.timestamp <= milestone_.deadline)
                revert MilestoneDeadlineNotReached();
        } else if (
            milestone_.status != MilestoneStatus.Submitted &&
            milestone_.status != MilestoneStatus.Approved
        ) {
            revert InvalidDisputeMilestoneStatus();
        }

        if (_freeLiquidity(project_) < milestone_.amount)
            revert InsufficientFundingForMilestone();

        dispute_.active = true;
        dispute_.raisedBy = msg.sender;
        dispute_.raisedAt = _toUint64(block.timestamp);
        dispute_.reasonURI = reasonURI;
        project_.activeDisputeCount += 1;
        project_.reservedAmount += milestone_.amount;
        project_.status = ProjectStatus.Disputed;

        emit DisputeRaised(
            projectId,
            milestoneIndex,
            msg.sender,
            project_.token,
            uint8(milestone_.status),
            reasonURI
        );
    }

    /// @notice Arbitrator multisig resolution path for disputed milestones.
    function resolveDispute(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) external onlyRole(ARBITRATOR_ROLE) nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        _requireProjectOperable(project_);
        _requireMilestoneIndex(project_, milestoneIndex);

        MilestoneDispute storage dispute_ = _disputes[projectId][
            milestoneIndex
        ];
        if (!dispute_.active) revert DisputeNotActive();

        if (
            !_confirmArbitratorAction(
                _resolveDisputeActionId(
                    projectId,
                    milestoneIndex,
                    kind,
                    freelancerAmount,
                    clientAmount,
                    dispute_.raisedAt
                )
            )
        ) return;
        // Return means vote recorded, but quorum is not reached yet.

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status == MilestoneStatus.Pending) {
            if (project_.reservedAmount < milestone_.amount)
                revert InsufficientFundingForMilestone();
            if (kind != DisputeResolutionKind.RefundToClient)
                revert PendingDisputeMustRefundClient();
        }
        _requireNoBlockingAlternativeRecipientChange(
            projectId,
            milestoneIndex,
            kind,
            freelancerAmount,
            clientAmount
        );
        _validateResolutionAmounts(
            kind,
            milestone_.amount,
            freelancerAmount,
            clientAmount
        );

        uint256 totalOut = freelancerAmount + clientAmount;
        if (totalOut > milestone_.amount) revert InsufficientEscrowLiquidity();
        _requireProjectCanSettleAmount(project_, totalOut);

        _clearDispute(dispute_);
        _advanceEmergencyResolveNonce(projectId, milestoneIndex);
        project_.activeDisputeCount -= 1;
        project_.reservedAmount -= milestone_.amount;

        project_.releasedAmount += freelancerAmount;
        project_.refundedAmount += clientAmount;
        _tokenOutstanding[project_.token] -= totalOut;

        if (kind == DisputeResolutionKind.RefundToClient) {
            milestone_.status = MilestoneStatus.Refunded;
        } else {
            milestone_.status = MilestoneStatus.Released;
        }
        milestone_.reviewEnteredAt = 0;

        _markMilestoneSettled(project_);
        _refreshProjectStatus(projectId, project_);

        _payoutAndEmitDisputeResolution(
            projectId,
            milestoneIndex,
            kind,
            freelancerAmount,
            clientAmount,
            project_
        );
        _arbitratorActionNonce[projectId][milestoneIndex] += 1;
        _clearAlternativeRecipients(projectId, milestoneIndex);
    }

    /// @notice Timeout fallback for pending-milestone disputes only.
    function resolveStaleDisputeByTimeout(
        uint256 projectId,
        uint256 milestoneIndex
    ) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        _requireProjectOperable(project_);
        if (project_.client != msg.sender) revert NotProjectClient();
        _requireMilestoneIndex(project_, milestoneIndex);

        MilestoneDispute storage dispute_ = _disputes[projectId][
            milestoneIndex
        ];
        if (!dispute_.active) revert DisputeNotActive();
        if (block.timestamp < uint256(dispute_.raisedAt) + DISPUTE_TIMEOUT)
            revert DisputeTimeoutNotReached();

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status != MilestoneStatus.Pending)
            revert StaleDisputeTimeoutOnlyForPendingMilestone();

        uint256 amount = milestone_.amount;
        if (amount > project_.reservedAmount)
            revert InsufficientEscrowLiquidity();
        _requireProjectCanSettleAmount(project_, amount);

        _clearDispute(dispute_);
        _advanceEmergencyResolveNonce(projectId, milestoneIndex);
        project_.activeDisputeCount -= 1;
        project_.reservedAmount -= amount;
        project_.refundedAmount += amount;
        _tokenOutstanding[project_.token] -= amount;
        milestone_.status = MilestoneStatus.Refunded;

        _markMilestoneSettled(project_);
        _refreshProjectStatus(projectId, project_);

        address clientRecipient = _clientRecipient(
            projectId,
            milestoneIndex,
            project_
        );
        _safeTransferExact(IERC20(project_.token), clientRecipient, amount);
        emit DisputeResolved(
            projectId,
            milestoneIndex,
            msg.sender,
            uint8(DisputeResolutionKind.RefundToClient),
            0,
            amount
        );
        emit DisputePayoutRecipients(
            projectId,
            milestoneIndex,
            address(0),
            clientRecipient
        );
        _clearAlternativeRecipients(projectId, milestoneIndex);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function projectCount() external view returns (uint256) {
        return _projectCount;
    }

    function getProject(
        uint256 projectId
    ) external view returns (Project memory) {
        if (projectId == 0 || projectId > _projectCount)
            revert ProjectNotFound();
        return _projects[projectId];
    }

    function getMilestone(
        uint256 projectId,
        uint256 milestoneIndex
    ) external view returns (Milestone memory) {
        Project storage project_ = _projectStorage(projectId);
        _requireMilestoneIndex(project_, milestoneIndex);
        return _milestones[projectId][milestoneIndex];
    }

    function getDispute(
        uint256 projectId,
        uint256 milestoneIndex
    )
        external
        view
        returns (
            bool active,
            address raisedBy,
            uint64 raisedAt,
            string memory reasonURI,
            string memory lastAppendedEvidenceURI
        )
    {
        Project storage project_ = _projectStorage(projectId);
        _requireMilestoneIndex(project_, milestoneIndex);
        MilestoneDispute storage dispute_ = _disputes[projectId][
            milestoneIndex
        ];
        return (
            dispute_.active,
            dispute_.raisedBy,
            dispute_.raisedAt,
            dispute_.reasonURI,
            dispute_.lastAppendedEvidenceURI
        );
    }

    function arbitratorThreshold() external view returns (uint256) {
        return _arbitratorThreshold;
    }

    function arbitratorCount() external view returns (uint256) {
        return _arbitratorCount;
    }

    function isAllowedToken(address token) external view returns (bool) {
        return _allowedTokens[token];
    }

    function untrackedTokenBalance(
        address token
    ) external view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 liabilities = _tokenOutstanding[token];
        return balance > liabilities ? balance - liabilities : 0;
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _projectStorage(
        uint256 projectId
    ) private view returns (Project storage project_) {
        if (projectId == 0 || projectId > _projectCount)
            revert ProjectNotFound();
        project_ = _projects[projectId];
    }

    function _requireMilestoneIndex(
        Project storage project_,
        uint256 milestoneIndex
    ) private view {
        if (milestoneIndex >= project_.milestoneCount)
            revert MilestoneIndexOutOfRange();
    }

    function _requireProjectOperable(Project storage project_) private view {
        if (
            project_.status == ProjectStatus.Completed ||
            project_.status == ProjectStatus.Cancelled
        ) {
            revert ProjectNotActive();
        }
    }

    function _enforceRoleSeparationOnGrant(
        bytes32 role,
        address account
    ) private view {
        if (role == ARBITRATOR_ROLE) {
            if (
                hasRole(DEFAULT_ADMIN_ROLE, account) ||
                hasRole(PAUSER_ROLE, account)
            ) {
                revert RoleSeparationViolation();
            }
            return;
        }
        if (role == DEFAULT_ADMIN_ROLE || role == PAUSER_ROLE) {
            if (hasRole(ARBITRATOR_ROLE, account))
                revert RoleSeparationViolation();
        }
    }

    function _assertRoleSeparationInvariant(address account) private view {
        if (
            hasRole(ARBITRATOR_ROLE, account) &&
            (hasRole(DEFAULT_ADMIN_ROLE, account) ||
                hasRole(PAUSER_ROLE, account))
        ) {
            revert RoleSeparationViolation();
        }
    }

    function _normalizeArbitratorThreshold() private {
        uint256 previousThreshold = _arbitratorThreshold;
        if (_arbitratorCount == 0) {
            _arbitratorThreshold = 1;
        } else if (_arbitratorThreshold > _arbitratorCount) {
            _arbitratorThreshold = _arbitratorCount;
        }
        if (_arbitratorThreshold != previousThreshold) {
            emit ArbitratorThresholdUpdated(
                previousThreshold,
                _arbitratorThreshold,
                msg.sender
            );
        }
    }

    function _requireProjectCanSettleAmount(
        Project storage project_,
        uint256 amount
    ) private view {
        if (
            project_.releasedAmount + project_.refundedAmount + amount >
            project_.fundedAmount
        ) {
            revert InsufficientEscrowLiquidity();
        }
    }

    function _requireUriLength(string calldata uri) private pure {
        if (bytes(uri).length > MAX_URI_BYTES) revert URITooLong();
    }

    function _isDisputeActive(
        uint256 projectId,
        uint256 milestoneIndex
    ) private view returns (bool) {
        return _disputes[projectId][milestoneIndex].active;
    }

    function _requirePreviousMilestonesCompleted(
        uint256 projectId,
        uint256 milestoneIndex
    ) private view {
        for (uint256 i = 0; i < milestoneIndex; ) {
            MilestoneStatus status = _milestones[projectId][i].status;
            if (
                status != MilestoneStatus.Released &&
                status != MilestoneStatus.Refunded
            ) {
                revert PreviousMilestoneNotCompleted();
            }
            unchecked {
                ++i;
            }
        }
    }

    function _isValidPartySignature(
        address signer,
        bytes32 digest,
        bytes calldata signature
    ) private view returns (bool) {
        if (signer.code.length > 0) {
            try IERC1271(signer).isValidSignature(digest, signature) returns (
                bytes4 magicValue
            ) {
                return magicValue == EIP1271_MAGIC_VALUE;
            } catch {
                return false;
            }
        }

        return _recoverSigner(digest, signature) == signer;
    }

    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) private pure returns (address signer) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > _SECP256K1N_DIV_2) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        signer = ecrecover(digest, v, r, s);
    }

    function _consumePartyRecipientAuthorizationNonce(
        uint256 projectId,
        uint256 milestoneIndex,
        bool isFreelancer,
        uint256 nonce
    ) private {
        uint256 expectedNonce = _partyRecipientAuthorizationNonce[projectId][
            milestoneIndex
        ][isFreelancer];
        if (nonce != expectedNonce) revert InvalidAuthorizationNonce();
        _partyRecipientAuthorizationNonce[projectId][milestoneIndex][
            isFreelancer
        ] = expectedNonce + 1;
    }

    function _setPartyAuthorizedRecipient(
        uint256 projectId,
        uint256 milestoneIndex,
        bool isFreelancer,
        address newRecipient
    ) private {
        if (newRecipient == address(this)) revert InvalidRecipient();

        if (isFreelancer) {
            _partyAuthorizedFreelancerRecipient[projectId][
                milestoneIndex
            ] = newRecipient;
        } else {
            _partyAuthorizedClientRecipient[projectId][
                milestoneIndex
            ] = newRecipient;
        }
    }

    function _availableLiquidity(
        Project storage project_
    ) private view returns (uint256) {
        return
            project_.fundedAmount -
            project_.releasedAmount -
            project_.refundedAmount;
    }

    function _freeLiquidity(
        Project storage project_
    ) private view returns (uint256) {
        // Spendable amount = available amount - funds reserved for active disputes.
        uint256 available = _availableLiquidity(project_);
        if (available <= project_.reservedAmount) return 0;
        return available - project_.reservedAmount;
    }

    function _freelancerRecipient(
        uint256 projectId,
        uint256 milestoneIndex,
        Project storage project_
    ) private view returns (address) {
        address recipient = _partyAuthorizedFreelancerRecipient[projectId][
            milestoneIndex
        ];

        if (recipient == address(0)) {
            recipient = _partyAuthorizedFreelancerRecipient[projectId][
                _PROJECT_WIDE_RECIPIENT_SCOPE
            ];
        }

        if (recipient == address(0)) {
            recipient = _alternativeFreelancerRecipient[projectId][
                milestoneIndex
            ];
        }

        if (recipient == address(0)) {
            recipient = project_.freelancer;
        }

        if (recipient == address(this)) revert InvalidRecipient();
        return recipient;
    }

    function _clientRecipient(
        uint256 projectId,
        uint256 milestoneIndex,
        Project storage project_
    ) private view returns (address) {
        address recipient = _partyAuthorizedClientRecipient[projectId][
            milestoneIndex
        ];

        if (recipient == address(0)) {
            recipient = _partyAuthorizedClientRecipient[projectId][
                _PROJECT_WIDE_RECIPIENT_SCOPE
            ];
        }

        if (recipient == address(0)) {
            recipient = _alternativeClientRecipient[projectId][milestoneIndex];
        }

        if (recipient == address(0)) {
            recipient = project_.client;
        }

        if (recipient == address(this)) revert InvalidRecipient();
        return recipient;
    }

    function _projectClientRecipient(
        uint256 projectId,
        Project storage project_
    ) private view returns (address) {
        address recipient = _partyAuthorizedClientRecipient[projectId][
            _PROJECT_WIDE_RECIPIENT_SCOPE
        ];

        if (recipient == address(0)) {
            recipient = project_.client;
        }

        if (recipient == address(this)) revert InvalidRecipient();
        return recipient;
    }

    function _clearAlternativeRecipients(
        uint256 projectId,
        uint256 milestoneIndex
    ) private {
        _alternativeFreelancerRecipient[projectId][milestoneIndex] = address(0);
        _alternativeClientRecipient[projectId][milestoneIndex] = address(0);
        _pendingAlternativeFreelancerRecipient[projectId][
            milestoneIndex
        ] = PendingAlternativeRecipient({
            recipient: address(0),
            executableAfter: 0
        });
        _pendingAlternativeClientRecipient[projectId][
            milestoneIndex
        ] = PendingAlternativeRecipient({
            recipient: address(0),
            executableAfter: 0
        });
    }

    function _clearAlternativeRecipientLeg(
        uint256 projectId,
        uint256 milestoneIndex,
        bool isFreelancer
    ) private {
        if (isFreelancer) {
            _alternativeFreelancerRecipient[projectId][
                milestoneIndex
            ] = address(0);
            _pendingAlternativeFreelancerRecipient[projectId][
                milestoneIndex
            ] = PendingAlternativeRecipient({
                recipient: address(0),
                executableAfter: 0
            });
        } else {
            _alternativeClientRecipient[projectId][milestoneIndex] = address(0);
            _pendingAlternativeClientRecipient[projectId][
                milestoneIndex
            ] = PendingAlternativeRecipient({
                recipient: address(0),
                executableAfter: 0
            });
        }
    }

    function _requireNoBlockingAlternativeRecipientChange(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) private view {
        if (
            kind == DisputeResolutionKind.ReleaseToFreelancer ||
            kind == DisputeResolutionKind.Split ||
            freelancerAmount > 0
        ) {
            PendingAlternativeRecipient
                storage pendingFreelancer = _pendingAlternativeFreelancerRecipient[
                    projectId
                ][milestoneIndex];
            if (
                pendingFreelancer.recipient != address(0) &&
                block.timestamp < pendingFreelancer.executableAfter
            ) {
                revert AlternativeRecipientChangePending();
            }
        }
        if (
            kind == DisputeResolutionKind.RefundToClient ||
            kind == DisputeResolutionKind.Split ||
            clientAmount > 0
        ) {
            PendingAlternativeRecipient
                storage pendingClient = _pendingAlternativeClientRecipient[
                    projectId
                ][milestoneIndex];
            if (
                pendingClient.recipient != address(0) &&
                block.timestamp < pendingClient.executableAfter
            ) {
                revert AlternativeRecipientChangePending();
            }
        }
    }

    function _confirmArbitratorAction(bytes32 actionId) private returns (bool) {
        if (_arbitratorActionExecuted[actionId])
            revert ArbitratorActionAlreadyExecuted();

        uint256 required = _arbitratorThreshold;
        if (_arbitratorActionApprovedBy[actionId][msg.sender]) {
            // Same arbitrator cannot add a second vote.
            return _arbitratorActionApprovals[actionId] >= required;
        }

        _arbitratorActionApprovedBy[actionId][msg.sender] = true;
        uint256 approvals = _arbitratorActionApprovals[actionId] + 1;
        _arbitratorActionApprovals[actionId] = approvals;
        emit ArbitratorActionConfirmed(
            actionId,
            msg.sender,
            approvals,
            required
        );

        if (approvals >= required) {
            _arbitratorActionExecuted[actionId] = true;
            return true;
        }
        return false;
    }

    /// @dev `_arbitratorThreshold` and `_arbitratorConfigNonce` are
    /// intentionally part of the actionId domain separator. Any threshold or
    /// arbitrator-set change produces a new actionId hash and voids in-flight
    /// votes for the previous action domain.
    function _setAlternativeRecipientActionId(
        uint256 projectId,
        uint256 milestoneIndex,
        bool isFreelancer,
        address newRecipient,
        uint64 raisedAt
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _ACTION_DOMAIN_SET_ALT_RECIPIENT,
                    projectId,
                    milestoneIndex,
                    isFreelancer,
                    newRecipient,
                    raisedAt,
                    _arbitratorActionNonce[projectId][milestoneIndex],
                    _arbitratorThreshold,
                    _arbitratorConfigNonce
                )
            );
    }

    /// @dev `_arbitratorThreshold` and `_arbitratorConfigNonce` are
    /// intentionally part of the actionId domain separator. Any threshold or
    /// arbitrator-set change produces a new actionId hash and voids in-flight
    /// votes for the previous action domain.
    function _resolveDisputeActionId(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount,
        uint64 raisedAt
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _ACTION_DOMAIN_RESOLVE_DISPUTE,
                    projectId,
                    milestoneIndex,
                    kind,
                    freelancerAmount,
                    clientAmount,
                    raisedAt,
                    _arbitratorActionNonce[projectId][milestoneIndex],
                    _arbitratorThreshold,
                    _arbitratorConfigNonce
                )
            );
    }

    function _payoutAndEmitDisputeResolution(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount,
        Project storage project_
    ) private {
        address freelancerRecipient = _freelancerRecipient(
            projectId,
            milestoneIndex,
            project_
        );
        address clientRecipient = _clientRecipient(
            projectId,
            milestoneIndex,
            project_
        );
        IERC20 token_ = IERC20(project_.token);
        _safeTransferExact(token_, freelancerRecipient, freelancerAmount);
        _safeTransferExact(token_, clientRecipient, clientAmount);

        emit DisputeResolved(
            projectId,
            milestoneIndex,
            msg.sender,
            uint8(kind),
            freelancerAmount,
            clientAmount
        );
        emit DisputePayoutRecipients(
            projectId,
            milestoneIndex,
            freelancerRecipient,
            clientRecipient
        );
    }

    function _markMilestoneSettled(Project storage project_) private {
        uint256 newCount = project_.settledMilestoneCount + 1;
        if (newCount > project_.milestoneCount)
            revert MilestoneCountInvariantViolation();
        project_.settledMilestoneCount = newCount;
    }

    function _refreshProjectStatus(
        uint256 /* projectId */,
        Project storage project_
    ) private {
        if (project_.activeDisputeCount > 0) {
            project_.status = ProjectStatus.Disputed;
            return;
        }
        if (project_.settledMilestoneCount == project_.milestoneCount) {
            project_.status = ProjectStatus.Completed;
            return;
        }
        project_.status = ProjectStatus.Active;
    }

    function _clearDispute(MilestoneDispute storage dispute_) private {
        dispute_.active = false;
        dispute_.raisedBy = address(0);
        dispute_.raisedAt = 0;
        dispute_.reasonURI = "";
        dispute_.lastAppendedEvidenceURI = "";
    }

    function _toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) revert TimestampOverflow();
        return uint64(value);
    }

    function _advanceEmergencyResolveNonce(
        uint256 projectId,
        uint256 milestoneIndex
    ) private {
        uint256 newNonce = _emergencyResolveNonce[projectId][milestoneIndex] +
            1;
        _emergencyResolveNonce[projectId][milestoneIndex] = newNonce;
        emit EmergencyDisputeResolutionNonceAdvanced(
            projectId,
            milestoneIndex,
            newNonce,
            msg.sender
        );
    }

    function _erc20CheckedReturn(bytes memory ret) private pure {
        if (ret.length == 0) return;
        if (ret.length < 32 || !abi.decode(ret, (bool)))
            revert TokenTransferFailed();
    }

    function _erc20Call(address token, bytes memory data) private {
        (bool success, bytes memory ret) = token.call(data);
        if (!success) revert TokenTransferFailed();
        _erc20CheckedReturn(ret);
    }

    function _erc20TransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) private {
        _erc20Call(
            token,
            abi.encodeWithSelector(
                IERC20.transferFrom.selector,
                from,
                to,
                amount
            )
        );
    }

    function _erc20Transfer(address token, address to, uint256 amount) private {
        _erc20Call(
            token,
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
    }

    function _safeTransferExact(
        IERC20 token_,
        address to,
        uint256 amount
    ) private {
        if (amount == 0) return;
        if (to == address(this)) revert InvalidRecipient();
        // Verify exact token movement on both sides.
        uint256 preContract = token_.balanceOf(address(this));
        uint256 preRecipient = token_.balanceOf(to);
        _erc20Transfer(address(token_), to, amount);
        if (preContract - token_.balanceOf(address(this)) != amount)
            revert InvalidPayoutTransfer();
        if (token_.balanceOf(to) - preRecipient != amount)
            revert InvalidPayoutTransfer();
    }

    function _validateResolutionAmounts(
        DisputeResolutionKind kind,
        uint256 milestoneAmount,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) private pure {
        if (kind == DisputeResolutionKind.ReleaseToFreelancer) {
            if (freelancerAmount != milestoneAmount || clientAmount != 0)
                revert InvalidResolutionAmounts();
        } else if (kind == DisputeResolutionKind.RefundToClient) {
            if (clientAmount != milestoneAmount || freelancerAmount != 0)
                revert InvalidResolutionAmounts();
        } else {
            if (freelancerAmount == 0 || clientAmount == 0)
                revert InvalidSplitAmounts();
            if (freelancerAmount + clientAmount != milestoneAmount)
                revert InvalidSplitAmounts();
        }
    }

    /// @dev Shared validation used by emergency proposal and execution paths.
    function _validateEmergencyResolvePayload(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    )
        private
        view
        returns (
            Project storage project_,
            Milestone storage milestone_,
            MilestoneDispute storage dispute_
        )
    {
        project_ = _projectStorage(projectId);
        _requireProjectOperable(project_);
        _requireMilestoneIndex(project_, milestoneIndex);

        dispute_ = _disputes[projectId][milestoneIndex];
        if (!dispute_.active) revert DisputeNotActive();

        milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status == MilestoneStatus.Pending) {
            // Pending disputes are timeout/non-delivery cases; only refund is allowed.
            if (project_.reservedAmount < milestone_.amount)
                revert InsufficientFundingForMilestone();
            if (kind != DisputeResolutionKind.RefundToClient)
                revert PendingDisputeMustRefundClient();
        }
        _validateResolutionAmounts(
            kind,
            milestone_.amount,
            freelancerAmount,
            clientAmount
        );

        if (freelancerAmount + clientAmount > milestone_.amount)
            revert InsufficientEscrowLiquidity();
    }

    function _emergencyResolveActionHash(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _ACTION_DOMAIN_EMERGENCY_RESOLVE,
                    projectId,
                    milestoneIndex,
                    _emergencyResolveNonce[projectId][milestoneIndex],
                    kind,
                    freelancerAmount,
                    clientAmount
                )
            );
    }
}
