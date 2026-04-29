CREATE TYPE "EmergencyResolutionProposalStatus" AS ENUM (
  'proposed',
  'cancelled',
  'executed',
  'invalidated'
);

CREATE TABLE "emergency_resolution_proposals" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "projectDbId" TEXT,
  "projectId" TEXT NOT NULL,
  "milestoneIndex" INTEGER NOT NULL,
  "actionHash" TEXT,
  "kind" INTEGER,
  "freelancerAmount" TEXT,
  "clientAmount" TEXT,
  "readyAt" TIMESTAMP(3),
  "status" "EmergencyResolutionProposalStatus" NOT NULL,
  "txHash" TEXT NOT NULL,
  "logIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "emergency_resolution_proposals_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "emergency_resolution_proposals"
ADD CONSTRAINT "emergency_resolution_proposals_projectDbId_fkey"
FOREIGN KEY ("projectDbId") REFERENCES "projects"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "emergency_resolution_proposals_chainId_txHash_logIndex_key"
ON "emergency_resolution_proposals"("chainId", "txHash", "logIndex");

CREATE INDEX "emergency_resolution_proposals_chainId_contractAddress_projectId_milestoneIndex_updatedAt_idx"
ON "emergency_resolution_proposals"("chainId", "contractAddress", "projectId", "milestoneIndex", "updatedAt");

CREATE INDEX "emergency_resolution_proposals_projectDbId_updatedAt_idx"
ON "emergency_resolution_proposals"("projectDbId", "updatedAt");
