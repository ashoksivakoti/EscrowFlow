# Alternative Recipient Governance Policy

## Purpose
Define strict controls for use of `setAlternativeRecipient` so the platform avoids dispute-resolution deadlocks and stuck escrow funds.

## Scope
- Applies to all production disputes in `EscrowFlowRegistry`.
- Applies to arbitrators, dispute-ops leads, and security/on-call responders.

## Policy Statement
- `setAlternativeRecipient` is **exception-only** and must not be used in normal payout flows.
- Allowed use-cases:
  - Confirmed recipient blacklist/freeze event.
  - Legally required recipient replacement.
  - Custody migration where original recipient can no longer receive token transfers.
- Non-allowed use-cases:
  - Convenience wallet changes.
  - Normal account rotation.
  - Any case where original recipient remains functional and reachable.

## Required Preconditions
Before proposing an alternative recipient, all of the following must be true:
- Dispute case ticket exists with severity and owner.
- Root cause is documented with evidence (transaction hash, token error, legal request).
- Replacement address ownership is verified.
- Impact analysis confirms no simpler recovery path exists.
- Secondary approver (ops lead or security lead) signs off.

## Execution Controls
- Arbitrators must execute `setAlternativeRecipient` only after approvals are recorded in the ticket.
- The case must immediately be moved to `pending-recipient-watch` state.
- Relevant party (client/freelancer) must be contacted within 15 minutes with execution instructions.
- No dispute may remain in active queue without explicit pending-recipient owner.

## Time Boundaries
- Initial execution target: within `ALTERNATIVE_RECIPIENT_DELAY + 12h`.
- If execution is not completed by T+24h, auto-escalate to dispute-ops lead.
- If execution is not completed by T+48h, escalate to Sev-1 incident handling.

## Prohibited Operational State
- A case with pending alternative recipient and no active owner.
- A pending alternative recipient without outreach log and escalation timestamps.
- Multiple unresolved pending-recipient actions for the same party without management review.

## Evidence and Audit Requirements
For every use of `setAlternativeRecipient`, store:
- Case ID and milestone identifiers.
- On-chain tx links for set/execute actions.
- Ownership verification evidence for replacement address.
- Approver identities and timestamps.
- Final post-incident note (what happened, what changed).

## Accountability
- Dispute-ops lead: responsible for SLA tracking and escalations.
- Arbitrator lead: responsible for justified use and quorum readiness.
- Security lead: responsible for incident response when deadlock risk appears.

## Review Cadence
- Monthly policy review with metrics:
  - Count of alt-recipient requests.
  - % executed within SLA.
  - Number of Sev-1 escalations.
  - Repeated root-cause categories.
