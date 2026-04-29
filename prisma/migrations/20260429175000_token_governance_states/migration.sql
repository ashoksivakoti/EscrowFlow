CREATE TABLE "token_governance_states" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "reviewed" BOOLEAN NOT NULL DEFAULT false,
  "allowed" BOOLEAN NOT NULL DEFAULT false,
  "reviewedBy" TEXT,
  "lastUpdatedTxHash" TEXT NOT NULL,
  "lastUpdatedBlock" BIGINT NOT NULL,
  "lastUpdatedLogIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "token_governance_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "token_governance_states_chainId_contractAddress_token_key"
ON "token_governance_states"("chainId", "contractAddress", "token");

CREATE INDEX "token_governance_states_chainId_contractAddress_reviewed_allowed_updatedAt_idx"
ON "token_governance_states"("chainId", "contractAddress", "reviewed", "allowed", "updatedAt");
