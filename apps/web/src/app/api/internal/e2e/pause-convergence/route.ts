import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { createPublicClient, createWalletClient, http, isHex } from "viem";

import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { prisma } from "@/lib/prisma";
import { getEventSyncEnv } from "@/server/event-sync/env";
import { AppError } from "@/server/errors/app-error";
import { handleRoute } from "@/server/http/route-handler";
import { syncEscrowEventsOnce } from "@/server/services/event-sync-service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.internal.e2e.pause-convergence.get", async () => {
    assertE2EEnabled();
    requireE2EToken(request);
    const payload = await readConvergenceState();
    return NextResponse.json(payload);
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.internal.e2e.pause-convergence.post", async () => {
    assertE2EEnabled();
    requireE2EToken(request);

    const env = getEventSyncEnv();
    const adminKey = process.env.E2E_ADMIN_PRIVATE_KEY?.trim();
    if (!adminKey || !isHex(adminKey) || adminKey.length !== 66) {
      throw AppError.badRequest(
        "E2E_PRIVATE_KEY_INVALID",
        "E2E_ADMIN_PRIVATE_KEY must be a 32-byte hex private key",
      );
    }

    const chain = arbitrumSepolia;
    const rpcUrl = env.EVENT_SYNC_RPC_URL;
    const account = privateKeyToAccount(adminKey);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
    const contractAddress = canonicalDeployment.contracts.EscrowFlowRegistry;
    const pausedBefore = await publicClient.readContract({
      address: contractAddress,
      abi: escrowRegistryAbi,
      functionName: "paused",
    });
    const action = pausedBefore ? "unpause" : "pause";
    const txHash = await walletClient.writeContract({
      address: contractAddress,
      abi: escrowRegistryAbi,
      functionName: action,
      args: [] as const,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const scope = `ESCROW_REGISTRY:${contractAddress.toLowerCase()}`;
    const checkpointBlock =
      receipt.blockNumber > 0n ? receipt.blockNumber - 1n : receipt.blockNumber;
    const checkpointLogIndex = checkpointBlock === receipt.blockNumber ? 0 : null;
    const checkpointBlockHash =
      checkpointBlock === receipt.blockNumber
        ? receipt.blockHash ?? null
        : (await publicClient.getBlock({ blockNumber: checkpointBlock })).hash ?? null;
    // E2E determinism: fast-forward checkpoint right before tx block so sync projects this tx now.
    await prisma.eventSyncCheckpoint.upsert({
      where: {
        chainId_scope: {
          chainId: canonicalDeployment.chainId,
          scope,
        },
      },
      update: {
        lastProcessedBlock: checkpointBlock,
        lastProcessedBlockHash: checkpointBlockHash,
        lastProcessedLogIndex: checkpointLogIndex,
        lastError: null,
      },
      create: {
        chainId: canonicalDeployment.chainId,
        scope,
        lastProcessedBlock: checkpointBlock,
        lastProcessedBlockHash: checkpointBlockHash,
        lastProcessedLogIndex: checkpointLogIndex,
        lastError: null,
      },
    });
    const sync = await syncEscrowEventsOnce();
    const payload = await readConvergenceState();

    return NextResponse.json({
      action,
      txHash,
      sync,
      ...payload,
    });
  });
}

async function readConvergenceState(): Promise<{
  apiPaused: boolean | null;
  chainPaused: boolean;
  lastTxHash: string | null;
  lastEventName: string | null;
  lastBlock: string | null;
}> {
  const env = getEventSyncEnv();
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(env.EVENT_SYNC_RPC_URL),
  });
  const chainPaused = await publicClient.readContract({
    address: canonicalDeployment.contracts.EscrowFlowRegistry,
    abi: escrowRegistryAbi,
    functionName: "paused",
  });
  const row = await prisma.contractPauseState.findUnique({
    where: {
      chainId_contractAddress: {
        chainId: canonicalDeployment.chainId,
        contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry.toLowerCase(),
      },
    },
    select: {
      paused: true,
      eventName: true,
      lastChangedTxHash: true,
      lastChangedBlock: true,
    },
  });
  return {
    apiPaused: row?.paused ?? null,
    chainPaused,
    lastTxHash: row?.lastChangedTxHash ?? null,
    lastEventName: row?.eventName ?? null,
    lastBlock: row?.lastChangedBlock?.toString() ?? null,
  };
}

function assertE2EEnabled(): void {
  if (process.env.E2E_ENABLED !== "true") {
    throw AppError.notFound("E2E_DISABLED", "E2E routes are disabled");
  }
}

function requireE2EToken(request: Request): void {
  const required = process.env.E2E_INTERNAL_TOKEN?.trim();
  if (!required) {
    throw AppError.badRequest("E2E_TOKEN_MISSING", "E2E_INTERNAL_TOKEN is required");
  }
  const provided = request.headers.get("x-e2e-token");
  if (!provided || !safeTokenEquals(provided, required)) {
    throw AppError.unauthenticated("Unauthorized e2e request");
  }
}

function safeTokenEquals(provided: string, required: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const requiredBuffer = Buffer.from(required);
  if (providedBuffer.length !== requiredBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, requiredBuffer);
}
