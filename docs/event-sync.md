# Event Sync Foundation

This document describes the first event-sync foundation for EscrowFlow.

## Goals

- Ingest on-chain escrow events into PostgreSQL.
- Keep processing idempotent and restart-safe.
- Update app state for project lifecycle milestones.
- Provide an extension path for additional events.

## Current scope

The sync service currently consumes:

- `ProjectCreated`
- `ProjectFunded`

Source contract: `EscrowFlowRegistry`.

Implementation entrypoints:

- Service: `apps/web/src/server/services/event-sync-service.ts`
- Trigger route: `POST /api/internal/event-sync`

## Configuration

Server-side environment variables (`apps/web/.env.local`):

- `EVENT_SYNC_RPC_URL`
- `EVENT_SYNC_CHAIN_ID`
- `EVENT_SYNC_CONTRACT_ADDRESS`
- `EVENT_SYNC_SCOPE` (optional)
- `EVENT_SYNC_START_BLOCK` (optional)
- `EVENT_SYNC_BATCH_SIZE` (optional)
- `EVENT_SYNC_CONFIRMATIONS` (optional)
- `EVENT_SYNC_RPC_RETRIES` (optional; default `2`)
- `EVENT_SYNC_RPC_RETRY_DELAY_MS` (optional; default `800`)
- `EVENT_SYNC_TRIGGER_TOKEN` (optional; recommended for production)

## Processing model

1. Load `EventSyncCheckpoint` by `(chainId, scope)`.
2. Compute a safe head (`latest - confirmations`).
3. Read a bounded block window (`batch size`) from checkpoint to safe head.
4. Fetch supported logs (`ProjectCreated`, `ProjectFunded`) and order by `(blockNumber, logIndex)`.
5. For each log:
   - apply project state update
   - upsert `TransactionLog` (unique by `chainId + txHash + logIndex`)
   - advance checkpoint to that exact log
6. If no logs were found in the scanned window, checkpoint advances to `toBlock` with `lastProcessedLogIndex = null`.

## Idempotency guarantees

- `TransactionLog` writes use `upsert` keyed by `(chainId, txHash, logIndex)`.
- Reprocessing the same block window is safe.
- Checkpoint updates happen incrementally per processed log, so restarts resume from the last confirmed cursor.

## Stored event data

For each ingested event:

- `txHash`
- `blockNumber`
- `logIndex`
- `eventName`
- structured `payload` (including decoded args)
- block timestamp (when available) inside payload:
  - `blockTimestamp` (ISO)
  - `blockTimestampUnixSeconds`

## Project state updates

### `ProjectCreated`

- Match existing `Project` by `chainId + escrowContractAddress + onChainProjectId`.
- If found, update token, total value, agreement URI, and funding-related status.
- If not found and client wallet exists as a user, create an imported project record.

### `ProjectFunded`

- Find project by chain/contract/on-chain id.
- Update status to:
  - `ACTIVE` when funded amount reaches/exceeds total
  - otherwise `AWAITING_ESCROW`
- Preserve terminal statuses (`COMPLETED`, `CANCELLED`, `DISPUTED`).

## Restart safety

- The service is safe to call repeatedly.
- If a run fails:
  - checkpoint `lastError` is recorded
  - successful prior log upserts/checkpoint updates remain valid
  - next run resumes from checkpoint and replays idempotently if needed

## Triggering the sync

Manual trigger example:

```bash
curl -X POST \
  -H "x-event-sync-token: $EVENT_SYNC_TRIGGER_TOKEN" \
  http://localhost:3000/api/internal/event-sync
```

If `EVENT_SYNC_TRIGGER_TOKEN` is unset, the route accepts local requests without header validation. In production, set a strong token and route this endpoint through a trusted scheduler.

Scheduler command:

```bash
pnpm event-sync:trigger
```

Supporting variables:

- `EVENT_SYNC_INTERNAL_URL`
- `EVENT_SYNC_TRIGGER_RETRIES`
- `EVENT_SYNC_TRIGGER_RETRY_DELAY_MS`

## Extending for future events

To add new events (e.g. milestone/dispute events):

1. Add ABI event definition in `event-sync-service.ts`.
2. Add fetch mapping to `SupportedEventLog`.
3. Add a dedicated handler for DB projection updates.
4. Include event-specific payload fields in `TransactionLog`.
5. Keep ordering, idempotent upsert, and checkpoint progression unchanged.
