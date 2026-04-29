# Event Sync (Production)

EscrowFlow event sync is canonical-only and ingests `EscrowFlowRegistry` events into PostgreSQL for runtime projections, auditability, and reporting.

## Canonical runtime scope

- Chain: `arbitrumSepolia`
- Chain ID: `421614`
- Canonical registry: `0xe5AF7E2CF6435de6B0a0520518FCaaab851BB40c`
- Scope format: `ESCROW_REGISTRY:<lowercase_registry_address>`

The deprecated registry (`0x268993a0E0342972a52C58aa2dD1A9953fd57aCf`) is blocked by runtime validation and must not be used as an active event source.

## Entrypoints

- Sync service: `apps/web/src/server/services/event-sync-service.ts`
- Trigger route: `POST /api/internal/event-sync`

## Required configuration

Set in `apps/web/.env.local` (or deployment env):

- `EVENT_SYNC_RPC_URL`
- `EVENT_SYNC_CHAIN_ID=421614`
- `EVENT_SYNC_CONTRACT_ADDRESS=0xe5AF7E2CF6435de6B0a0520518FCaaab851BB40c`
- `EVENT_SYNC_SCOPE=ESCROW_REGISTRY:0xe5af7e2cf6435de6b0a0520518fcaaab851bb40c`
- `EVENT_SYNC_START_BLOCK=263614332` (**required**; must equal canonical deployment block)

Optional tuning:

- `EVENT_SYNC_BATCH_SIZE` (default `500`)
- `EVENT_SYNC_CONFIRMATIONS` (default `2`)
- `EVENT_SYNC_RPC_RETRIES` (default `2`)
- `EVENT_SYNC_RPC_RETRY_DELAY_MS` (default `800`)
- `EVENT_SYNC_REWIND_DEPTH` (default `50`; reorg rewind distance)

Database/runtime requirements:

- `DATABASE_URL` must point to a reachable PostgreSQL instance.
- Prisma migrations must be applied before running `sanity:full-sync` (for CI: `pnpm db:migrate:deploy`).
- `sanity:full-sync` does not bypass DB checks in release mode.

Operational trigger auth:

- `EVENT_SYNC_TRIGGER_TOKEN` (required in production)

## Supported events

Required:

- `ProjectCreated`
- `ProjectFunded`
- `MilestoneSubmitted`
- `MilestoneApproved`
- `MilestoneFundsReleased`
- `DisputeRaised`
- `DisputeEvidenceAppended`
- `DisputeResolved`
- `DisputePayoutRecipients`
- `TokenReviewAttested`
- `AllowedTokenUpdated`
- `ProjectCancelled`
- `ProjectEmergencyCancelled`
- `EmergencyDisputeResolutionProposed`
- `EmergencyDisputeResolutionCancelled`
- `EmergencyDisputeResolved`
- `AlternativeRecipientSet`
- `AlternativeRecipientExecuted`
- `ArbitratorThresholdUpdated`
- `ArbitratorActionConfirmed`
- `RoleAdminChanged`
- `RoleGranted`
- `RoleRevoked`
- `Paused`
- `Unpaused`

Optional (if present in ABI/network history):

- `EmergencyDisputeResolutionNonceAdvanced`

## Projection and storage model

### Chain event ledger

- `transaction_logs` is the canonical event ledger.
- Chain events are stored with `sourceType=chain_event`.
- Unique key: `(chainId, txHash, logIndex)` for replay-safe idempotency.

### Source type distinction

`transaction_logs.sourceType`:

- `chain_event`: on-chain indexed event (authoritative for on-chain state)
- `synthetic_client_reconcile`: client/backend reconciliation metadata
- `backend_metadata`: off-chain metadata logs

Reporting/state logic that must mirror chain state should filter to `chain_event`.

### Normalized projection tables

Current projections include:

- `contract_pause_states`
- `emergency_resolution_proposals`
- `alternative_recipient_states`
- `token_governance_states`
- `role_membership_states`
- `role_governance_events`
- `arbitrator_governance_states`
- `arbitrator_threshold_histories`

Checkpoint state:

- `event_sync_checkpoints` (including `lastProcessedBlock`, `lastProcessedBlockHash`, `lastProcessedLogIndex`, `cursorState`)

## Reorg handling

On each sync run:

1. Load checkpoint for `(chainId, scope)`.
2. Verify `lastProcessedBlockHash` against current chain hash for `lastProcessedBlock`.
3. If mismatch is detected, compute rewind block:
   - `max(EVENT_SYNC_START_BLOCK, lastProcessedBlock - EVENT_SYNC_REWIND_DEPTH)`
4. Rewind transaction:
   - delete `chain_event` rows from rewind block onward for canonical scope
   - clear normalized projection tables for canonical scope
   - rebuild projections deterministically from retained pre-rewind chain events
   - atomically rewrite checkpoint/cursor
5. Continue normal processing from rewind cursor.

This guarantees reorg-safe replay and consistent projections.

Accepted rewind depth:

- Runtime depth is `EVENT_SYNC_REWIND_DEPTH` (default `50` blocks).
- DB-level mismatch -> rewind -> replay coverage is enforced by `apps/web/src/server/services/event-sync-service.reorg.integration.test.ts`.

## Atomicity model

Per event:

- projection updates
- chain-event upsert in `transaction_logs`
- checkpoint advance

are committed in a single DB transaction.

Rewind/rebuild is also executed atomically in a transaction.

## Triggering sync

Manual:

```bash
curl -X POST \
  -H "x-event-sync-token: $EVENT_SYNC_TRIGGER_TOKEN" \
  http://localhost:3000/api/internal/event-sync
```

Scheduler command:

```bash
pnpm event-sync:trigger
```
