# Deadlock Incident Runbook

## Objective
Restore dispute settlement progress when funds are at risk of being stuck due to unresolved pending alternative recipient changes.

## Trigger Conditions
Open this runbook when any of the following occur:
- `AlternativeRecipientSet` emitted and no matching `AlternativeRecipientExecuted` within 24 hours.
- Dispute settlement attempt fails because `AlternativeRecipientChangePending`.
- Party key-loss/unreachability is reported during dispute payout routing.

## Roles
- Incident Commander (IC): dispute-ops lead.
- On-chain Operator: executes approved transactions and validates chain state.
- Arbitrator Coordinator: reassembles quorum and coordinates arbitrator actions.
- Security Liaison: handles key compromise or custody concerns.
- Communications Owner: contacts client/freelancer and logs acknowledgements.

## Severity Classification
- Sev-2: pending recipient unresolved at T+24h, dispute still progressing.
- Sev-1: unresolved at T+48h or no feasible path to resolution with current quorum/party availability.

## SLA and Escalation Ladder
- T+0: open incident record, assign owner, notify involved party.
- T+24h: escalate to IC and Arbitrator Coordinator; require hourly updates.
- T+48h: escalate to Sev-1 bridge; involve security and executive escalation path.
- T+96h hard-stop: mandatory management review and contingency decision.

## Step-by-Step Procedure

### Step 1: Confirm State
- Verify project and milestone are still operable.
- Confirm active dispute exists.
- Confirm pending recipient exists for the payout leg.
- Confirm `executableAfter` has passed.
- Record links to all relevant transactions/events.

### Step 2: Determine Blocker Category
- Category A: party reachable but has not executed.
- Category B: party unreachable or key lost.
- Category C: arbitrator quorum unavailable.
- Category D: mixed blocker (party and quorum issues).

### Step 3: Act by Blocker
- Category A:
  - Communications owner sends immediate execution instruction and deadline.
  - If no action in 4 hours, escalate to formal notice path.
- Category B:
  - Trigger key-recovery verification workflow.
  - Prepare legal/compliance validation package for replacement control.
- Category C:
  - Rebuild quorum roster (activate backup arbitrators).
  - Schedule quorum confirmation and on-chain follow-up action.
- Category D:
  - Run Category B and C in parallel under Sev-1.

### Step 4: Prevent Silent Drift
- Require status updates every 2 hours in incident channel.
- Require explicit owner for next on-chain action.
- Do not close incident while a pending recipient remains unresolved.

### Step 5: Resolution and Closure
- Verify recipient execution or cleared replacement path is complete.
- Verify dispute settlement can proceed (or completed).
- Attach final state evidence and close incident with root-cause summary.

## Mandatory Incident Evidence
- Project ID, milestone index, dispute state snapshot.
- Pending recipient leg and `executableAfter`.
- Contact log to client/freelancer.
- Quorum availability snapshot at each escalation checkpoint.
- Final chain evidence showing unblock.

## Post-Incident Review
Complete within 3 business days:
- Root-cause category and control gaps.
- SLA breaches and why.
- Required follow-up actions and owners.
- Whether future use of alternative recipient should be restricted for same account cohort.
