# Arbitrator Quorum Operations Standard

## Purpose
Maintain continuous dispute-resolution capacity and prevent funds from becoming stuck due to arbitrator quorum loss.

## Scope
- Applies to all environments handling production disputes.
- Applies to arbitration operations, security, and governance admins.

## Quorum Policy
- Maintain active arbitrator count at **threshold + 2** minimum buffer.
- If active count falls to **threshold + 1**, open degraded-capacity warning.
- If active count equals threshold, declare quorum-risk incident.
- If active count falls below threshold, declare Sev-1 service risk immediately.

## Weekly Quorum Health Check
Run once per week with an auditable checklist:
- Verify active arbitrator roster and role assignments.
- Verify threshold value against current roster size.
- Verify contactability of each active arbitrator.
- Verify backup arbitrator readiness and activation path.
- Record check outcome and remediation tasks.

## Rotation Readiness Test
At least monthly:
- Simulate temporary removal of one active arbitrator.
- Confirm quorum still satisfies policy buffer.
- Confirm backup activation can be executed within target SLA (4 hours).

## Degraded Mode Operations
When in degraded-capacity warning:
- Freeze discretionary alternative-recipient actions.
- Prioritize resolution of disputes with pending recipient changes.
- Restrict non-critical operational changes that could affect arbitrator availability.

## Emergency Response
When below required quorum:
- Trigger Sev-1 incident with arbitration coordinator as incident commander.
- Activate backup arbitrators under emergency authorization process.
- Publish update cadence every hour until quorum restored.
- Prioritize oldest unresolved disputes and high-value escrow first.

## Role Separation Safety
- Maintain strict separation between admin/pauser and arbitrator responsibilities.
- Any emergency staffing change must preserve role-separation constraints.

## Contact and Availability Requirements
- Every arbitrator must maintain:
  - two independent contact channels,
  - defined backup availability window,
  - on-call rotation schedule acknowledgement.

## Governance Reporting
Report monthly:
- Average active arbitrator buffer above threshold.
- Time spent in degraded mode.
- Number of incidents caused by quorum pressure.
- Mean time to restore quorum.

## KPIs
- 100% weeks with completed quorum health checks.
- 0 unresolved quorum deficits longer than 24 hours.
- 100% monthly rotation readiness tests completed.
