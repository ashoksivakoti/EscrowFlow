import "server-only";

import { isAddress } from "viem";
import { z } from "zod";
import {
  canonicalDeployment,
} from "@/lib/contracts/contract-addresses";

const DEPRECATED_ESCROW_REGISTRY_ADDRESS =
  "0x268993a0e0342972a52c58aa2dd1a9953fd57acf";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CANONICAL_ESCROW_REGISTRY_ADDRESS =
  canonicalDeployment.contracts.EscrowFlowRegistry.toLowerCase();

const schema = z.object({
  EVENT_SYNC_RPC_URL: z.string().url("EVENT_SYNC_RPC_URL must be a valid URL"),
  EVENT_SYNC_CHAIN_ID: z.coerce.number().int().positive().default(canonicalDeployment.chainId),
  EVENT_SYNC_CONTRACT_ADDRESS: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "EVENT_SYNC_CONTRACT_ADDRESS is not a valid address")
    .refine(
      (v) => v.toLowerCase() !== DEPRECATED_ESCROW_REGISTRY_ADDRESS,
      "EVENT_SYNC_CONTRACT_ADDRESS must not use deprecated EscrowFlowRegistry",
    )
    .transform((v) => v.toLowerCase())
    .default(canonicalDeployment.contracts.EscrowFlowRegistry),
  EVENT_SYNC_SCOPE: z.string().trim().min(1).optional(),
  EVENT_SYNC_START_BLOCK: z.coerce
    .number()
    .int()
    .positive()
    .default(canonicalDeployment.deploymentBlock),
  EVENT_SYNC_BATCH_SIZE: z.coerce.number().int().positive().max(5000).default(500),
  EVENT_SYNC_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(2),
  EVENT_SYNC_RPC_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  EVENT_SYNC_RPC_RETRY_DELAY_MS: z.coerce.number().int().min(100).max(10_000).default(800),
  EVENT_SYNC_REWIND_DEPTH: z.coerce.number().int().min(1).max(10_000).default(50),
  EVENT_SYNC_TRIGGER_TOKEN: z.string().min(16).optional(),
}).superRefine((data, ctx) => {
  const canonicalScope = `ESCROW_REGISTRY:${data.EVENT_SYNC_CONTRACT_ADDRESS}`;
  if (data.EVENT_SYNC_SCOPE !== canonicalScope) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["EVENT_SYNC_SCOPE"],
      message: `EVENT_SYNC_SCOPE must be ${canonicalScope}`,
    });
  }

  if (IS_PRODUCTION) {
    const rawStartBlock = process.env.EVENT_SYNC_START_BLOCK?.trim();
    if (!rawStartBlock) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EVENT_SYNC_START_BLOCK"],
        message: "EVENT_SYNC_START_BLOCK is required in production",
      });
    }
    if (rawStartBlock && Number(rawStartBlock) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EVENT_SYNC_START_BLOCK"],
        message: "EVENT_SYNC_START_BLOCK must be greater than 0 in production",
      });
    }
    if (data.EVENT_SYNC_CHAIN_ID !== canonicalDeployment.chainId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EVENT_SYNC_CHAIN_ID"],
        message: `EVENT_SYNC_CHAIN_ID must be ${canonicalDeployment.chainId} in production`,
      });
    }
    if (data.EVENT_SYNC_CONTRACT_ADDRESS !== CANONICAL_ESCROW_REGISTRY_ADDRESS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EVENT_SYNC_CONTRACT_ADDRESS"],
        message: "EVENT_SYNC_CONTRACT_ADDRESS must match canonical EscrowFlowRegistry in production",
      });
    }
  }
  if (data.EVENT_SYNC_CONTRACT_ADDRESS !== CANONICAL_ESCROW_REGISTRY_ADDRESS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["EVENT_SYNC_CONTRACT_ADDRESS"],
      message: "EVENT_SYNC_CONTRACT_ADDRESS must match canonical EscrowFlowRegistry",
    });
  }
  if (data.EVENT_SYNC_START_BLOCK !== canonicalDeployment.deploymentBlock) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["EVENT_SYNC_START_BLOCK"],
      message: `EVENT_SYNC_START_BLOCK must equal canonical deployment block ${canonicalDeployment.deploymentBlock}`,
    });
  }
});

export type EventSyncEnv = z.infer<typeof schema>;

let cached: EventSyncEnv | null = null;

export function getEventSyncEnv(): EventSyncEnv {
  if (cached) {
    return cached;
  }
  const contractAddress =
    process.env.EVENT_SYNC_CONTRACT_ADDRESS ??
    canonicalDeployment.contracts.EscrowFlowRegistry;

  const scope =
    process.env.EVENT_SYNC_SCOPE?.trim() ||
    `ESCROW_REGISTRY:${contractAddress.toLowerCase()}`;

  cached = schema.parse({
    EVENT_SYNC_RPC_URL: process.env.EVENT_SYNC_RPC_URL,
    EVENT_SYNC_CHAIN_ID:
      process.env.EVENT_SYNC_CHAIN_ID ?? canonicalDeployment.chainId,
    EVENT_SYNC_CONTRACT_ADDRESS: contractAddress,
    EVENT_SYNC_SCOPE: scope,
    EVENT_SYNC_START_BLOCK:
      process.env.EVENT_SYNC_START_BLOCK ?? canonicalDeployment.deploymentBlock,
    EVENT_SYNC_BATCH_SIZE: process.env.EVENT_SYNC_BATCH_SIZE,
    EVENT_SYNC_CONFIRMATIONS: process.env.EVENT_SYNC_CONFIRMATIONS,
    EVENT_SYNC_RPC_RETRIES: process.env.EVENT_SYNC_RPC_RETRIES,
    EVENT_SYNC_RPC_RETRY_DELAY_MS: process.env.EVENT_SYNC_RPC_RETRY_DELAY_MS,
    EVENT_SYNC_REWIND_DEPTH: process.env.EVENT_SYNC_REWIND_DEPTH,
    EVENT_SYNC_TRIGGER_TOKEN: process.env.EVENT_SYNC_TRIGGER_TOKEN,
  });
  return cached;
}

export function resetEventSyncEnvCacheForTests(): void {
  cached = null;
}
