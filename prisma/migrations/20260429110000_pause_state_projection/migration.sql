-- Add normalized latest pause state projection per contract.
CREATE TABLE "contract_pause_states" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "paused" BOOLEAN NOT NULL,
  "eventName" TEXT NOT NULL,
  "updatedBy" TEXT,
  "lastChangedBlock" BIGINT NOT NULL,
  "lastChangedTxHash" TEXT NOT NULL,
  "lastChangedLogIndex" INTEGER NOT NULL,
  "lastChangedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "contract_pause_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_pause_states_chainId_contractAddress_key"
ON "contract_pause_states"("chainId", "contractAddress");

CREATE INDEX "contract_pause_states_chainId_contractAddress_updatedAt_idx"
ON "contract_pause_states"("chainId", "contractAddress", "updatedAt");
