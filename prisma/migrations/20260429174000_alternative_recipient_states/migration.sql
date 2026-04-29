CREATE TYPE "AlternativeRecipientStatus" AS ENUM (
  'pending',
  'active',
  'cleared'
);

CREATE TABLE "alternative_recipient_states" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "projectDbId" TEXT,
  "projectId" TEXT NOT NULL,
  "milestoneIndex" INTEGER NOT NULL,
  "isFreelancer" BOOLEAN NOT NULL,
  "pendingRecipient" TEXT,
  "executableAfter" BIGINT,
  "activeRecipient" TEXT,
  "partyAuthorizedRecipient" TEXT,
  "status" "AlternativeRecipientStatus" NOT NULL,
  "updatedAtBlock" BIGINT NOT NULL,
  "updatedAtTxHash" TEXT NOT NULL,
  "updatedAtLogIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "alternative_recipient_states_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "alternative_recipient_states"
ADD CONSTRAINT "alternative_recipient_states_projectDbId_fkey"
FOREIGN KEY ("projectDbId") REFERENCES "projects"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "alt_recipient_states_scope_uq"
ON "alternative_recipient_states"("chainId", "contractAddress", "projectId", "milestoneIndex", "isFreelancer");

CREATE INDEX "alt_recipient_states_project_leg_updated_at_idx"
ON "alternative_recipient_states"("projectDbId", "milestoneIndex", "isFreelancer", "updatedAt");

CREATE INDEX "alt_recipient_states_scope_updated_at_idx"
ON "alternative_recipient_states"("chainId", "contractAddress", "projectId", "milestoneIndex", "isFreelancer", "updatedAt");
