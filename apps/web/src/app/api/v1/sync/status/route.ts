import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";

import { prisma } from "@/lib/prisma";
import { getEventSyncEnv } from "@/server/event-sync/env";
import { requireAuthenticated } from "@/server/guards/auth-guard";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  await requireAuthenticated(request);
  const env = getEventSyncEnv();
  const client = createPublicClient({
    transport: http(env.EVENT_SYNC_RPC_URL),
  });
  const scope = env.EVENT_SYNC_SCOPE ?? `ESCROW_REGISTRY:${env.EVENT_SYNC_CONTRACT_ADDRESS.toLowerCase()}`;
  const [latestChainBlock, checkpoint] = await Promise.all([
    client.getBlockNumber(),
    prisma.eventSyncCheckpoint.findUnique({
      where: {
        chainId_scope: {
          chainId: env.EVENT_SYNC_CHAIN_ID,
          scope,
        },
      },
      select: {
        lastProcessedBlock: true,
        lastSuccessAt: true,
      },
    }),
  ]);

  const lastSyncedBlock = checkpoint?.lastProcessedBlock ?? null;
  const lagBlocks = lastSyncedBlock === null ? null : Number(latestChainBlock - lastSyncedBlock);

  let lagSeconds: number | null = null;
  if (lastSyncedBlock !== null) {
    try {
      const [latestBlockData, syncedBlockData] = await Promise.all([
        client.getBlock({ blockNumber: latestChainBlock }),
        client.getBlock({ blockNumber: lastSyncedBlock }),
      ]);
      lagSeconds = Math.max(
        0,
        Number(latestBlockData.timestamp) - Number(syncedBlockData.timestamp),
      );
    } catch {
      lagSeconds = null;
    }
  }

  return NextResponse.json({
    scope,
    chainId: env.EVENT_SYNC_CHAIN_ID,
    latestChainBlock: latestChainBlock.toString(),
    lastSyncedBlock: lastSyncedBlock?.toString() ?? null,
    lagBlocks,
    lagSeconds,
    indexedBehind: lagBlocks !== null ? lagBlocks > 0 : true,
    lastSuccessAt: checkpoint?.lastSuccessAt?.toISOString() ?? null,
  });
}
