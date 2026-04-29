CREATE TYPE "RoleGovernanceEventType" AS ENUM (
  'role_granted',
  'role_revoked',
  'role_admin_changed'
);

CREATE TABLE "role_membership_states" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "account" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "lastUpdatedBy" TEXT,
  "lastUpdatedTxHash" TEXT NOT NULL,
  "lastUpdatedBlock" BIGINT NOT NULL,
  "lastUpdatedLogIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "role_membership_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_membership_states_chainId_contractAddress_role_account_key"
ON "role_membership_states"("chainId", "contractAddress", "role", "account");

CREATE INDEX "role_membership_states_chainId_contractAddress_role_isActive_updatedAt_idx"
ON "role_membership_states"("chainId", "contractAddress", "role", "isActive", "updatedAt");

CREATE TABLE "role_governance_events" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "eventType" "RoleGovernanceEventType" NOT NULL,
  "role" TEXT NOT NULL,
  "account" TEXT,
  "sender" TEXT,
  "previousAdminRole" TEXT,
  "newAdminRole" TEXT,
  "txHash" TEXT NOT NULL,
  "logIndex" INTEGER NOT NULL,
  "blockNumber" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "role_governance_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_governance_events_chainId_txHash_logIndex_key"
ON "role_governance_events"("chainId", "txHash", "logIndex");

CREATE INDEX "role_governance_events_chainId_contractAddress_role_blockNumber_logIndex_idx"
ON "role_governance_events"("chainId", "contractAddress", "role", "blockNumber", "logIndex");

CREATE TABLE "arbitrator_governance_states" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "arbitratorCount" INTEGER NOT NULL DEFAULT 0,
  "arbitratorThreshold" BIGINT,
  "lastUpdatedTxHash" TEXT NOT NULL,
  "lastUpdatedBlock" BIGINT NOT NULL,
  "lastUpdatedLogIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "arbitrator_governance_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "arbitrator_governance_states_chainId_contractAddress_key"
ON "arbitrator_governance_states"("chainId", "contractAddress");

CREATE INDEX "arbitrator_governance_states_chainId_contractAddress_updatedAt_idx"
ON "arbitrator_governance_states"("chainId", "contractAddress", "updatedAt");

CREATE TABLE "arbitrator_threshold_histories" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "previousThreshold" BIGINT NOT NULL,
  "newThreshold" BIGINT NOT NULL,
  "updatedBy" TEXT,
  "txHash" TEXT NOT NULL,
  "logIndex" INTEGER NOT NULL,
  "blockNumber" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "arbitrator_threshold_histories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "arbitrator_threshold_histories_chainId_txHash_logIndex_key"
ON "arbitrator_threshold_histories"("chainId", "txHash", "logIndex");

CREATE INDEX "arbitrator_threshold_histories_chainId_contractAddress_blockNumber_logIndex_idx"
ON "arbitrator_threshold_histories"("chainId", "contractAddress", "blockNumber", "logIndex");
