// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title EscrowFlowRegistry
 * @author EscrowFlow
 * @notice Multi-project ERC20 milestone escrow: fund, submit, approve, release, and per-milestone disputes.
 * @dev Invariants: per-project `releasedAmount + refundedAmount <= fundedAmount`; milestone payouts never exceed
 *      `milestone.amount` for that index. Uses OpenZeppelin AccessControl, Pausable, ReentrancyGuard, SafeERC20.
 *      Assumes standard ERC20 (no fee-on-transfer); `token` must be a contract address at project creation.
 */
contract EscrowFlowRegistry is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice Pauses user-facing state changes (create, fund, milestones, raise dispute).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Resolves open milestone disputes via {resolveDispute}.
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");

    // -------------------------------------------------------------------------
    // Limits
    // -------------------------------------------------------------------------

    /// @notice Maximum milestones per project (gas bound).
    uint256 public constant MAX_MILESTONES = 50;

    /// @notice Maximum UTF-8 byte length for URI strings (metadata, submissions, dispute reasons).
    uint256 public constant MAX_URI_BYTES = 2048;

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
        Funded,
        Submitted,
        Approved,
        Released,
        Refunded,
        Disputed
    }

    /// @notice Arbitrator decision shape; encoded as uint8 in {DisputeResolved} for indexers.
    enum DisputeResolutionKind {
        ReleaseToFreelancer,
        RefundToClient,
        Split
    }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    /// @notice Milestone parameters supplied at project creation (immutable schedule).
    struct MilestoneInput {
        uint256 amount;
        uint64 deadline;
    }

    struct Milestone {
        uint256 amount;
        uint64 deadline;
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
        /// @notice Cumulative tokens sent to the client (refunds and split client leg).
        uint256 refundedAmount;
        string metadataURI;
        ProjectStatus status;
        uint256 milestoneCount;
    }

    struct MilestoneDispute {
        bool active;
        address raisedBy;
        uint64 raisedAt;
        string reasonURI;
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    uint256 private _projectCount;

    mapping(uint256 projectId => Project project) private _projects;

    mapping(uint256 projectId => mapping(uint256 milestoneIndex => Milestone milestone)) private _milestones;

    mapping(uint256 projectId => mapping(uint256 milestoneIndex => MilestoneDispute dispute)) private _disputes;

    // -------------------------------------------------------------------------
    // Events — indexed fields ordered for subgraph filters: id, parties, then details.
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

    /// @notice Client-triggered payout after approval (non-dispute path).
    event MilestoneFundsReleased(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed freelancer,
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

    event DisputeResolved(
        uint256 indexed projectId,
        uint256 indexed milestoneIndex,
        address indexed resolver,
        uint8 resolutionKind,
        uint256 freelancerAmount,
        uint256 clientAmount
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error InvalidToken();
    error ClientEqualsFreelancer();
    error InvalidMilestoneCount();
    error ZeroMilestoneAmount();
    error ProjectNotFound();
    error NotProjectClient();
    error ProjectNotActive();
    error ZeroFundingAmount();
    error FundingExceedsTotal();
    error MilestoneIndexOutOfRange();
    error NotProjectFreelancer();
    error InvalidMilestoneStatus();
    error InsufficientFundingForMilestone();
    error ReleaseExceedsFunded();
    error DisputeAlreadyActive();
    error DisputeNotActive();
    error NotAuthorizedToRaiseDispute();
    error InvalidDisputeMilestoneStatus();
    error InvalidResolutionAmounts();
    error InvalidSplitAmounts();
    error InsufficientEscrowLiquidity();
    error DisputeActive();
    error URITooLong();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @notice Deploy registry; `admin` receives `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE`.
     * @dev Grant `ARBITRATOR_ROLE` separately via {grantRole}. Consider a multisig for `admin`.
     */
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /// @notice Pause create, fund, milestone, and dispute-raise entrypoints.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpause user entrypoints.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // -------------------------------------------------------------------------
    // Projects
    // -------------------------------------------------------------------------

    /**
     * @notice Create a project; `msg.sender` is the client.
     * @param freelancer Recipient of milestone payouts.
     * @param token ERC-20 used for all escrow on this project (immutable).
     * @param metadataURI Off-chain project metadata (IPFS / HTTPS); bounded by {MAX_URI_BYTES}.
     * @param milestoneInputs Schedule; `totalAmount` is the sum of `amount` fields.
     * @return projectId Monotonic id starting at 1.
     */
    function createProject(
        address freelancer,
        address token,
        string calldata metadataURI,
        MilestoneInput[] calldata milestoneInputs
    ) external whenNotPaused returns (uint256 projectId) {
        if (freelancer == address(0) || token == address(0)) revert ZeroAddress();
        if (token.code.length == 0) revert InvalidToken();
        if (freelancer == msg.sender) revert ClientEqualsFreelancer();
        _requireUriLength(metadataURI);

        uint256 n = milestoneInputs.length;
        if (n == 0 || n > MAX_MILESTONES) revert InvalidMilestoneCount();

        uint256 totalAmount;
        projectId = _projectCount + 1;

        for (uint256 i = 0; i < n; ) {
            MilestoneInput calldata input = milestoneInputs[i];
            if (input.amount == 0) revert ZeroMilestoneAmount();
            totalAmount += input.amount;
            _milestones[projectId][i] = Milestone({
                amount: input.amount,
                deadline: input.deadline,
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
            metadataURI: metadataURI,
            status: ProjectStatus.Active,
            milestoneCount: n
        });

        _projectCount = projectId;

        emit ProjectCreated(projectId, msg.sender, freelancer, token, totalAmount, metadataURI, n);
    }

    /**
     * @notice Client pulls `amount` of project token from themselves into this contract.
     * @param amount Token amount in smallest units; cumulative funding cannot exceed `totalAmount`.
     */
    function fundProject(uint256 projectId, uint256 amount) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        if (project_.client != msg.sender) revert NotProjectClient();
        if (project_.status != ProjectStatus.Active) revert ProjectNotActive();
        if (amount == 0) revert ZeroFundingAmount();
        if (project_.fundedAmount + amount > project_.totalAmount) revert FundingExceedsTotal();

        project_.fundedAmount += amount;
        IERC20(project_.token).safeTransferFrom(msg.sender, address(this), amount);

        emit ProjectFunded(projectId, msg.sender, project_.token, amount, project_.fundedAmount);
    }

    // -------------------------------------------------------------------------
    // Milestones
    // -------------------------------------------------------------------------

    /**
     * @notice Freelancer submits deliverable reference.
     * @dev Requires `Pending`, no active dispute, and `fundedAmount` >= cumulative amounts through `milestoneIndex`.
     */
    function submitMilestone(uint256 projectId, uint256 milestoneIndex, string calldata submissionURI)
        external
        whenNotPaused
    {
        Project storage project_ = _projectStorage(projectId);
        if (project_.freelancer != msg.sender) revert NotProjectFreelancer();
        if (project_.status != ProjectStatus.Active) revert ProjectNotActive();
        _requireMilestoneIndex(project_, milestoneIndex);
        if (_isDisputeActive(projectId, milestoneIndex)) revert DisputeActive();
        _requireUriLength(submissionURI);

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status != MilestoneStatus.Pending) revert InvalidMilestoneStatus();

        uint256 requiredFunding = _cumulativeAmountThrough(projectId, milestoneIndex);
        if (project_.fundedAmount < requiredFunding) revert InsufficientFundingForMilestone();

        milestone_.submissionURI = submissionURI;
        milestone_.status = MilestoneStatus.Submitted;

        emit MilestoneSubmitted(projectId, milestoneIndex, msg.sender, submissionURI);
    }

    /**
     * @notice Client marks submission as accepted (payout not sent until {releaseMilestone}).
     */
    function approveMilestone(uint256 projectId, uint256 milestoneIndex) external whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        if (project_.client != msg.sender) revert NotProjectClient();
        if (project_.status != ProjectStatus.Active) revert ProjectNotActive();
        _requireMilestoneIndex(project_, milestoneIndex);
        if (_isDisputeActive(projectId, milestoneIndex)) revert DisputeActive();

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status != MilestoneStatus.Submitted) revert InvalidMilestoneStatus();

        milestone_.status = MilestoneStatus.Approved;

        emit MilestoneApproved(projectId, milestoneIndex, msg.sender);
    }

    /**
     * @notice Client pays the milestone `amount` from escrow to the freelancer.
     */
    function releaseMilestone(uint256 projectId, uint256 milestoneIndex) external nonReentrant whenNotPaused {
        Project storage project_ = _projectStorage(projectId);
        if (project_.client != msg.sender) revert NotProjectClient();
        if (project_.status != ProjectStatus.Active) revert ProjectNotActive();
        _requireMilestoneIndex(project_, milestoneIndex);
        if (_isDisputeActive(projectId, milestoneIndex)) revert DisputeActive();

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status != MilestoneStatus.Approved) revert InvalidMilestoneStatus();

        uint256 payout = milestone_.amount;
        if (project_.releasedAmount + project_.refundedAmount + payout > project_.fundedAmount) {
            revert ReleaseExceedsFunded();
        }

        project_.releasedAmount += payout;
        milestone_.status = MilestoneStatus.Released;

        IERC20(project_.token).safeTransfer(project_.freelancer, payout);

        emit MilestoneFundsReleased(
            projectId, milestoneIndex, project_.freelancer, project_.token, payout, project_.releasedAmount
        );
    }

    // -------------------------------------------------------------------------
    // Disputes
    // -------------------------------------------------------------------------

    /**
     * @notice Open a dispute on a milestone in review (`Submitted` or `Approved`).
     * @param reasonURI Evidence pointer; bounded by {MAX_URI_BYTES}.
     */
    function raiseDispute(uint256 projectId, uint256 milestoneIndex, string calldata reasonURI)
        external
        whenNotPaused
    {
        Project storage project_ = _projectStorage(projectId);
        if (project_.status != ProjectStatus.Active) revert ProjectNotActive();
        _requireMilestoneIndex(project_, milestoneIndex);
        _requireUriLength(reasonURI);

        MilestoneDispute storage dispute_ = _disputes[projectId][milestoneIndex];
        if (dispute_.active) revert DisputeAlreadyActive();
        if (msg.sender != project_.client && msg.sender != project_.freelancer) revert NotAuthorizedToRaiseDispute();

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        if (milestone_.status != MilestoneStatus.Submitted && milestone_.status != MilestoneStatus.Approved) {
            revert InvalidDisputeMilestoneStatus();
        }

        dispute_.active = true;
        dispute_.raisedBy = msg.sender;
        dispute_.raisedAt = uint64(block.timestamp);
        dispute_.reasonURI = reasonURI;

        emit DisputeRaised(
            projectId, milestoneIndex, msg.sender, project_.token, uint8(milestone_.status), reasonURI
        );
    }

    /**
     * @notice Arbitrator settles dispute: full release, full refund, or split summing to `milestone.amount`.
     * @dev Runs when paused so stuck escrow can be unwound; not subject to `whenNotPaused`.
     */
    function resolveDispute(
        uint256 projectId,
        uint256 milestoneIndex,
        DisputeResolutionKind kind,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) external onlyRole(ARBITRATOR_ROLE) nonReentrant {
        Project storage project_ = _projectStorage(projectId);
        _requireMilestoneIndex(project_, milestoneIndex);

        MilestoneDispute storage dispute_ = _disputes[projectId][milestoneIndex];
        if (!dispute_.active) revert DisputeNotActive();

        Milestone storage milestone_ = _milestones[projectId][milestoneIndex];
        uint256 milestoneAmount = milestone_.amount;

        _validateResolutionAmounts(kind, milestoneAmount, freelancerAmount, clientAmount);

        uint256 totalOut = freelancerAmount + clientAmount;
        uint256 liquidity = _availableLiquidity(project_);
        if (totalOut > liquidity) revert InsufficientEscrowLiquidity();

        _clearDispute(dispute_);

        project_.releasedAmount += freelancerAmount;
        project_.refundedAmount += clientAmount;

        if (kind == DisputeResolutionKind.RefundToClient) {
            milestone_.status = MilestoneStatus.Refunded;
        } else {
            milestone_.status = MilestoneStatus.Released;
        }

        IERC20 token_ = IERC20(project_.token);
        if (freelancerAmount > 0) {
            token_.safeTransfer(project_.freelancer, freelancerAmount);
        }
        if (clientAmount > 0) {
            token_.safeTransfer(project_.client, clientAmount);
        }

        emit DisputeResolved(
            projectId, milestoneIndex, msg.sender, uint8(kind), freelancerAmount, clientAmount
        );
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Number of projects ever created (last id == return value).
    function projectCount() external view returns (uint256) {
        return _projectCount;
    }

    function getProject(uint256 projectId) external view returns (Project memory) {
        if (projectId == 0 || projectId > _projectCount) revert ProjectNotFound();
        return _projects[projectId];
    }

    function getMilestone(uint256 projectId, uint256 milestoneIndex) external view returns (Milestone memory) {
        Project storage project_ = _projectStorage(projectId);
        _requireMilestoneIndex(project_, milestoneIndex);
        return _milestones[projectId][milestoneIndex];
    }

    function getDispute(uint256 projectId, uint256 milestoneIndex)
        external
        view
        returns (bool active, address raisedBy, uint64 raisedAt, string memory reasonURI)
    {
        Project storage project_ = _projectStorage(projectId);
        _requireMilestoneIndex(project_, milestoneIndex);
        MilestoneDispute storage dispute_ = _disputes[projectId][milestoneIndex];
        return (dispute_.active, dispute_.raisedBy, dispute_.raisedAt, dispute_.reasonURI);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _projectStorage(uint256 projectId) private view returns (Project storage project_) {
        if (projectId == 0 || projectId > _projectCount) revert ProjectNotFound();
        project_ = _projects[projectId];
    }

    function _requireMilestoneIndex(Project storage project_, uint256 milestoneIndex) private view {
        if (milestoneIndex >= project_.milestoneCount) revert MilestoneIndexOutOfRange();
    }

    function _requireUriLength(string calldata uri) private pure {
        if (bytes(uri).length > MAX_URI_BYTES) revert URITooLong();
    }

    function _cumulativeAmountThrough(uint256 projectId, uint256 throughIndex) private view returns (uint256 sum) {
        for (uint256 j = 0; j <= throughIndex; ) {
            sum += _milestones[projectId][j].amount;
            unchecked {
                ++j;
            }
        }
    }

    function _isDisputeActive(uint256 projectId, uint256 milestoneIndex) private view returns (bool) {
        return _disputes[projectId][milestoneIndex].active;
    }

    function _availableLiquidity(Project storage project_) private view returns (uint256) {
        return project_.fundedAmount - project_.releasedAmount - project_.refundedAmount;
    }

    function _clearDispute(MilestoneDispute storage dispute_) private {
        dispute_.active = false;
        dispute_.raisedBy = address(0);
        dispute_.raisedAt = 0;
        dispute_.reasonURI = "";
    }

    function _validateResolutionAmounts(
        DisputeResolutionKind kind,
        uint256 milestoneAmount,
        uint256 freelancerAmount,
        uint256 clientAmount
    ) private pure {
        if (kind == DisputeResolutionKind.ReleaseToFreelancer) {
            if (freelancerAmount != milestoneAmount || clientAmount != 0) revert InvalidResolutionAmounts();
        } else if (kind == DisputeResolutionKind.RefundToClient) {
            if (clientAmount != milestoneAmount || freelancerAmount != 0) revert InvalidResolutionAmounts();
        } else {
            if (freelancerAmount == 0 || clientAmount == 0) revert InvalidSplitAmounts();
            if (freelancerAmount + clientAmount != milestoneAmount) revert InvalidSplitAmounts();
        }
    }
}
