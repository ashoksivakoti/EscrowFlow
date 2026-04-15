# Domain model — EscrowFlow

**Status:** aligned with `prisma/schema.prisma`  
**Audience:** engineering, product, operations

This document explains **entities**, **relationships**, and **allowed status transitions**. The database schema is the source of truth for field names and indexes; keep this file updated when lifecycles change.

## Principles

- **Wallet-native identity:** a `User` is primarily identified by `walletAddress` (SIWE). Optional `Profile` holds display metadata and non-auth contact fields (e.g. email for notifications).
- **Roles are capabilities, not mutually exclusive:** `UserPlatformRole` rows grant `ADMIN`, `CLIENT`, and/or `FREELANCER`. Project participation is still explicit via `Project.clientUserId` / `Project.freelancerUserId`.
- **Money & chain safety:** token amounts are stored as **decimal strings** in smallest units (`amountWei`, `totalValueWei`) to avoid floating-point loss. On-chain identifiers that may exceed 64-bit use **strings** (e.g. `onChainProjectId`).
- **IPFS:** agreement, deliverables, and evidence fields store **URIs** (prefer canonical `ipfs://…`; gateways are an app concern).
- **Auditability:** `createdAt` / `updatedAt` on mutable rows; `TransactionLog` and `EventSyncCheckpoint` support reconciliation with chain history.

---

## Entity reference

### User

Represents a person (or machine wallet) using the platform.

| Field / idea    | Notes                                                            |
| --------------- | ---------------------------------------------------------------- |
| `walletAddress` | Unique; normalize consistently (e.g. lowercase) in the app.      |
| `lastLoginAt`   | Optional SIWE session hint.                                      |
| Relations       | `Profile`, `UserPlatformRole`, owned projects, submissions, etc. |

### Profile

1:1 with `User`. Human-facing fields only; **not** used for cryptographic authentication.

### UserPlatformRole

Associates a `User` with a `PlatformRole` (`ADMIN` | `CLIENT` | `FREELANCER`). A user may have **multiple** rows (e.g. both `CLIENT` and `FREELANCER`). `ADMIN` indicates platform staff / arbitrators in the product layer.

### Project

A scoped engagement between a **client** and an optional **freelancer**, with escrow metadata and IPFS agreement URI.

| Field / idea            | Notes                                               |
| ----------------------- | --------------------------------------------------- |
| `agreementIpfsUri`      | Agreement / scope artifact.                         |
| `escrowContractAddress` | Bound escrow / project contract.                    |
| `onChainProjectId`      | uint256-safe id as **string**.                      |
| `paymentTokenAddress`   | ERC20 used for deposits.                            |
| `totalValueWei`         | Optional denormalized sum of milestone `amountWei`. |

### Milestone

Work unit inside a project: ordering via `sortOrder`, funding and payout semantics via `amountWei` and `MilestoneStatus`.

| Field / idea              | Notes                                    |
| ------------------------- | ---------------------------------------- |
| `specificationIpfsUri`    | Optional milestone spec / acceptance.    |
| `fundedAt` / `releasedAt` | Optional lifecycle timestamps for audit. |

### Submission

Freelancer deliverable attempt for a milestone. **Versioning** uses `attemptNumber` (unique per milestone). `deliverablesIpfsUri` points at a manifest / bundle on IPFS.

### Dispute

Tied to a **milestone** (and optionally a `Submission`). `evidenceIpfsUri` holds dispute evidence. Resolution outcomes are explicit **terminal** `DisputeStatus` values; optional `resolutionTxHash` links to chain.

### TransactionLog

Append-only style log of on-chain activity mirrored for UX and auditing. Uniqueness: `(chainId, txHash, logIndex)` with `logIndex = -1` reserved for whole-transaction rows.

### Notification

User inbox item. `projectId` / `milestoneId` are optional context. Foreign keys use **`onDelete: SetNull`** so notifications can outlive deleted projects/milestones (body still shows text snapshot via `data` JSON if you store one in app code).

### Review

Post-completion feedback: **one review** from `authorUserId` to `subjectUserId` per `projectId` (`@@unique`). `rating` is 1–5 (enforce in validation, not only in DB).

### EventSyncCheckpoint

Indexer cursor per `(chainId, scope)` where `scope` might be a contract address or a logical name. Stores `lastProcessedBlock` (and optional log index / `cursorState` JSON) for idempotent sync.

---

## Status machines

The app layer **must** enforce transitions; the database stores the current state. Below, **→** means “allowed forward transition when business rules pass.” Backward transitions are usually **not** allowed unless explicitly noted (e.g. admin correction or data repair).

### PlatformRole

Static labels; no transitions. Users gain/lose roles by inserting/deleting `UserPlatformRole` rows (with your own authorization rules).

### ProjectStatus

```text
DRAFT
  → AWAITING_FREELANCER (optional: post draft, need to assign freelancer)
  → AWAITING_ESCROW     (freelancer set, need on-chain funding)
  → CANCELLED           (abandon draft or pre-escrow)

AWAITING_FREELANCER
  → AWAITING_ESCROW     (freelancer accepted / assigned)
  → CANCELLED

AWAITING_ESCROW
  → ACTIVE              (escrow funded per policy)
  → CANCELLED

ACTIVE
  → ON_HOLD             (pause by mutual policy or admin)
  → COMPLETED           (all milestones released / project closed successfully)
  → CANCELLED           (legal/ops cancellation — usually rare once funded)
  → DISPUTED            (escalation when disputes affect whole project — optional use)

ON_HOLD
  → ACTIVE
  → CANCELLED
  → DISPUTED

DISPUTED
  → ACTIVE              (disputes cleared, work resumes)
  → COMPLETED           (forced completion / settlement — policy-defined)
  → CANCELLED

COMPLETED / CANCELLED
  → (terminal — no further business transitions)
```

**Note:** You may keep the project in `ACTIVE` and represent disputes only at **milestone** level; `DISPUTED` at project level is optional for “whole-project pause” semantics.

### MilestoneStatus

```text
PLANNED
  → AWAITING_FUNDS
  → VOIDED              (removed before funding — policy)

AWAITING_FUNDS
  → FUNDED              (escrow received for this milestone)
  → VOIDED

FUNDED
  → IN_PROGRESS         (freelancer may start — may coincide with FUNDED)
  → VOIDED              (admin reversal — rare)

IN_PROGRESS
  → SUBMITTED           (freelancer submitted work)

SUBMITTED
  → CLIENT_REVIEW       (handoff to client review queue)

CLIENT_REVIEW
  → APPROVED
  → REJECTED
  → DISPUTED

APPROVED
  → RELEASED            (payout confirmed on-chain / mirrored in TransactionLog)

REJECTED
  → IN_PROGRESS         (freelancer revises — new Submission)
  → DISPUTED

DISPUTED
  → IN_PROGRESS         (resume after resolution, if work continues)
  → APPROVED            (resolution mandates payout)
  → RELEASED            (resolution + payout)
  → VOIDED              (policy — rare)

RELEASED / VOIDED
  → (terminal)
```

Keep **MilestoneStatus** aligned with **SubmissionStatus** in application code (e.g. when a submission is `ACCEPTED`, move milestone toward `APPROVED` / `RELEASED`).

### SubmissionStatus

```text
DRAFT
  → SUBMITTED

SUBMITTED
  → UNDER_REVIEW        (optional explicit step)
  → ACCEPTED
  → REJECTED
  → SUPERSEDED          (superseded by newer attempt with higher attemptNumber)

UNDER_REVIEW
  → ACCEPTED
  → REJECTED
  → SUPERSEDED

ACCEPTED / REJECTED / SUPERSEDED
  → (terminal)
```

When a new attempt is created, prior rows for the same milestone should move to **`SUPERSEDED`** (recommended) or remain historical with filtering by `attemptNumber`.

### DisputeStatus

```text
OPEN
  → AWAITING_RESPONSE
  → UNDER_ADMIN_REVIEW
  → WITHDRAWN

AWAITING_RESPONSE
  → UNDER_ADMIN_REVIEW
  → WITHDRAWN

UNDER_ADMIN_REVIEW
  → RESOLVED_CLIENT_FAVOR
  → RESOLVED_FREELANCER_FAVOR
  → RESOLVED_SPLIT
  → DISMISSED

RESOLVED_* / DISMISSED / WITHDRAWN
  → (terminal)
```

Record **`resolvedAt`**, **`resolvedByUserId`**, and optionally **`resolutionTxHash`** when closing a dispute.

### NotificationType

Labels only; no transitions. Use `readAt` for read/unread.

---

## Indexes (summary)

The schema defines indexes for common access paths: user wallet lookup, project lists by client/freelancer/status, milestone ordering and status filters, submission history per milestone, dispute queues, transaction history by chain block and project, notification inbox, review lookups, and sync checkpoints by chain/scope. See `schema.prisma` for the exact definitions.

---

## Next alignment steps

1. Map **Solidity events** to `TransactionLog.eventName` + `payload` shape (version the payload in JSON).
2. Add **Zod** (or similar) validators in the app for addresses, uint256 strings, IPFS URIs, and status transitions.
3. Mirror enums in **`@escrowflow/types`** only where it reduces duplication for the frontend (tomorrow’s iteration).
