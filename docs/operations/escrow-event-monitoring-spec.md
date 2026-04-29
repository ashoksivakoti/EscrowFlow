# Escrow Event Monitoring Specification

## Goal
Detect and escalate pending alternative recipient states before they become stuck-funds incidents.

## Contract Signals
Track at minimum:
- `AlternativeRecipientSet`
- `AlternativeRecipientExecuted`
- `DisputeRaised`
- `DisputeResolved`
- `EmergencyDisputeResolved`

## Derived Incident State
Create an `openPendingRecipient` record keyed by:
- `projectId`
- `milestoneIndex`
- `isFreelancer`

Lifecycle:
1. Open record on `AlternativeRecipientSet`.
2. Close record on matching `AlternativeRecipientExecuted`.
3. Close record if dispute is fully resolved for that milestone.
4. Mark stale if age exceeds SLA checkpoints.

## Required Fields
- `projectId`, `milestoneIndex`, `isFreelancer`
- `recipient`
- `setTxHash`, `setBlockTime`
- `executableAfter`
- `ageSeconds`
- `disputeActive`
- `status` (`open`, `executed`, `resolved`, `stale24h`, `stale48h`)

## Alert Rules

### Rule A: Immediate (T+0)
- Trigger: any new `AlternativeRecipientSet`.
- Severity: warning.
- Route: dispute-ops channel.
- Payload: identifiers, recipient, executable timestamp, case-owner placeholder.

### Rule B: Stale 24h (T+24)
- Trigger: open record age >= 24h and unresolved.
- Severity: high.
- Route: dispute-ops lead + arbitrator coordinator.
- Action required: acknowledge within 30 minutes and assign escalation owner.

### Rule C: Stale 48h (T+48)
- Trigger: open record age >= 48h and unresolved.
- Severity: critical (Sev-1).
- Route: incident bridge, security lead, ops leadership.
- Action required: incident command initiated immediately.

## Dashboard Requirements
Expose widgets:
- `pendingRecipientCount`
- `oldestPendingRecipientAge`
- `pendingRecipientByParty`
- `disputeCountWithPendingRecipient`
- `arbitratorQuorumHealth`

Required drill-down table columns:
- project/milestone, leg, set time, executable after, current age, owner, last outreach timestamp.

## Ownership and Routing
- Primary owner: dispute operations.
- Secondary owner: security/on-call for critical alerts.
- Escalation owner must be explicitly assigned on every 24h+ alert.

## Data Quality Checks
- Ensure block timestamps are normalized to UTC.
- Deduplicate reorg-affected events before alerting.
- Verify event parser compatibility after every contract deployment.
- Reconcile open records daily against on-chain event replay.

## Operational SLOs
- 99% of T+0 alerts delivered within 2 minutes.
- 100% of T+24 alerts acknowledged within 30 minutes.
- 100% of T+48 alerts open a Sev-1 incident within 15 minutes.

## Validation Plan
- Simulate full lifecycle in staging:
  - set recipient, no execution => confirm T+24/T+48 escalations.
  - set recipient then execute => verify closure and no stale alerts.
  - set recipient then dispute resolved => verify closure path.
