-- Distinguish authoritative chain events from synthetic/backend metadata logs.
CREATE TYPE "TransactionLogSourceType" AS ENUM (
  'chain_event',
  'synthetic_client_reconcile',
  'backend_metadata'
);

ALTER TABLE "transaction_logs"
ADD COLUMN "sourceType" "TransactionLogSourceType" NOT NULL DEFAULT 'backend_metadata';

-- Backfill: indexed on-chain logs are authoritative chain events.
UPDATE "transaction_logs"
SET "sourceType" = 'chain_event'
WHERE "logIndex" >= 0;

-- Backfill: known off-chain submission metadata rows.
UPDATE "transaction_logs"
SET "sourceType" = 'backend_metadata'
WHERE "eventName" = 'MilestoneSubmissionCreated';

-- Backfill: known chain reconciliation rows previously stored with logIndex=-1.
UPDATE "transaction_logs"
SET "sourceType" = 'synthetic_client_reconcile'
WHERE "logIndex" = -1
  AND "eventName" IN (
    'ProjectFunded',
    'MilestoneApproved',
    'MilestoneFundsReleased',
    'DisputeRaised',
    'DisputeResolved'
  );

CREATE INDEX "transaction_logs_sourceType_createdAt_idx"
ON "transaction_logs"("sourceType", "createdAt");
