# Wallet Onboarding Requirements

## Purpose
Reduce stuck-funds risk by ensuring production users can recover control and execute required dispute actions even if one signer/device is unavailable.

## Scope
- Applies to all production clients and freelancers creating or participating in escrow projects.
- Applies to direct users and institutional accounts.

## Required Wallet Posture
- Preferred: multisig or recoverable smart account.
- Minimum accepted: wallet with documented recovery path and tested backup ownership.
- Not accepted for high-value production tiers: single-key EOA without recovery controls.

## Onboarding Controls

### 1) Ownership Verification
- User must prove control of primary payout address.
- User must provide backup/recovery contact method.
- Institutional accounts must identify account operators and approval policy.

### 2) Recovery Readiness
- User must complete a recovery-readiness attestation:
  - key backup exists,
  - signer replacement process exists,
  - expected recovery time is documented.
- For multisig/smart accounts, submit signer policy and threshold.

### 3) Risk Tiering
- Low-risk tier: limited project size, temporary exception possible.
- Standard tier: recoverable wallet required.
- High-value tier: multisig/smart-account mandatory.

### 4) Operational Commitments
- User must commit to response SLA for dispute-related recipient execution requests.
- User must maintain at least one reachable authorized contact channel.

## Exception Process
- Temporary exceptions require:
  - explicit risk acceptance,
  - capped escrow exposure,
  - expiration date,
  - management approval.
- Exceptions cannot be auto-renewed.

## Revalidation Cadence
- Revalidate wallet controls every 90 days for active production accounts.
- Immediate revalidation required after:
  - key-loss reports,
  - major signer rotation,
  - compliance incidents.

## Offboarding and Restriction Rules
- Accounts failing minimum wallet posture may be restricted from creating new projects.
- Existing projects continue with enhanced monitoring until account posture is remediated.

## Evidence Checklist
- Signed onboarding attestation.
- Wallet type classification (EOA/multisig/smart account).
- Recovery method and contact proof.
- Exception approval records (if any).

## KPIs
- % production accounts with recoverable wallet posture.
- # of exceptions granted and expired.
- Mean response time for dispute-recipient execution requests.
