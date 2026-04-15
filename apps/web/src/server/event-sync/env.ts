import "server-only";

import { isAddress } from "viem";
import { z } from "zod";

const schema = z.object({
  EVENT_SYNC_RPC_URL: z.string().url("EVENT_SYNC_RPC_URL must be a valid URL"),
  EVENT_SYNC_CHAIN_ID: z.coerce.number().int().positive(),
  EVENT_SYNC_CONTRACT_ADDRESS: z
    .string()
    .trim()
    .refine((v) => isAddress(v), "EVENT_SYNC_CONTRACT_ADDRESS is not a valid address")
    .transform((v) => v.toLowerCase()),
  EVENT_SYNC_SCOPE: z.string().trim().min(1).optional(),
  EVENT_SYNC_START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  EVENT_SYNC_BATCH_SIZE: z.coerce.number().int().positive().max(5000).default(500),
  EVENT_SYNC_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(2),
  EVENT_SYNC_TRIGGER_TOKEN: z.string().min(16).optional(),
});

export type EventSyncEnv = z.infer<typeof schema>;

let cached: EventSyncEnv | null = null;

export function getEventSyncEnv(): EventSyncEnv {
  if (cached) {
    return cached;
  }
  cached = schema.parse({
    EVENT_SYNC_RPC_URL: process.env.EVENT_SYNC_RPC_URL,
    EVENT_SYNC_CHAIN_ID: process.env.EVENT_SYNC_CHAIN_ID,
    EVENT_SYNC_CONTRACT_ADDRESS: process.env.EVENT_SYNC_CONTRACT_ADDRESS,
    EVENT_SYNC_SCOPE: process.env.EVENT_SYNC_SCOPE,
    EVENT_SYNC_START_BLOCK: process.env.EVENT_SYNC_START_BLOCK,
    EVENT_SYNC_BATCH_SIZE: process.env.EVENT_SYNC_BATCH_SIZE,
    EVENT_SYNC_CONFIRMATIONS: process.env.EVENT_SYNC_CONFIRMATIONS,
    EVENT_SYNC_TRIGGER_TOKEN: process.env.EVENT_SYNC_TRIGGER_TOKEN,
  });
  return cached;
}

export function resetEventSyncEnvCacheForTests(): void {
  cached = null;
}
