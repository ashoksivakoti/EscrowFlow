import "server-only";

import { ProjectStatus, ProjectVisibility, Prisma } from "@prisma/client";
import { createPublicClient, http, parseAbiItem } from "viem";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/server/logging/logger";
import { getEventSyncEnv } from "@/server/event-sync/env";

const projectCreatedEvent = parseAbiItem(
  "event ProjectCreated(uint256 indexed projectId,address indexed client,address indexed freelancer,address token,uint256 totalAmount,string metadataURI,uint256 milestoneCount)",
);

const projectFundedEvent = parseAbiItem(
  "event ProjectFunded(uint256 indexed projectId,address indexed client,address indexed token,uint256 amount,uint256 fundedAmountAfter)",
);

type SupportedEventLog =
  | {
      name: "ProjectCreated";
      blockNumber: bigint;
      blockHash: `0x${string}` | null;
      txHash: `0x${string}`;
      logIndex: number;
      args: {
        projectId: bigint;
        client: `0x${string}`;
        freelancer: `0x${string}`;
        token: `0x${string}`;
        totalAmount: bigint;
        metadataURI: string;
        milestoneCount: bigint;
      };
    }
  | {
      name: "ProjectFunded";
      blockNumber: bigint;
      blockHash: `0x${string}` | null;
      txHash: `0x${string}`;
      logIndex: number;
      args: {
        projectId: bigint;
        client: `0x${string}`;
        token: `0x${string}`;
        amount: bigint;
        fundedAmountAfter: bigint;
      };
    };

export type EventSyncRunResult = {
  chainId: number;
  scope: string;
  fromBlock: string | null;
  toBlock: string | null;
  safeHeadBlock: string;
  processedEvents: number;
  processedProjectCreated: number;
  processedProjectFunded: number;
  checkpointBlock: string | null;
  checkpointLogIndex: number | null;
};

export async function syncEscrowEventsOnce(): Promise<EventSyncRunResult> {
  const env = getEventSyncEnv();
  const logger = createLogger("event-sync.escrow");
  const chainId = env.EVENT_SYNC_CHAIN_ID;
  const contractAddress = env.EVENT_SYNC_CONTRACT_ADDRESS as `0x${string}`;
  const scope = env.EVENT_SYNC_SCOPE ?? `ESCROW_REGISTRY:${contractAddress}`;

  const client = createPublicClient({
    transport: http(env.EVENT_SYNC_RPC_URL),
  });

  const safeHead = await getSafeHeadBlock(client, env.EVENT_SYNC_CONFIRMATIONS);
  const checkpoint = await prisma.eventSyncCheckpoint.findUnique({
    where: { chainId_scope: { chainId, scope } },
    select: { lastProcessedBlock: true, lastProcessedLogIndex: true },
  });
  const cursor = deriveCursor(checkpoint, env.EVENT_SYNC_START_BLOCK);
  if (cursor.fromBlock > safeHead) {
    return {
      chainId,
      scope,
      fromBlock: null,
      toBlock: null,
      safeHeadBlock: safeHead.toString(),
      processedEvents: 0,
      processedProjectCreated: 0,
      processedProjectFunded: 0,
      checkpointBlock: checkpoint?.lastProcessedBlock.toString() ?? null,
      checkpointLogIndex: checkpoint?.lastProcessedLogIndex ?? null,
    };
  }

  const toBlock = minBigInt(
    safeHead,
    cursor.fromBlock + BigInt(Math.max(1, env.EVENT_SYNC_BATCH_SIZE)) - 1n,
  );

  try {
    const orderedLogs = await withRetries(
      () =>
        fetchSupportedLogs(
          client,
          contractAddress,
          cursor.fromBlock,
          toBlock,
          checkpoint
            ? {
                blockNumber: checkpoint.lastProcessedBlock,
                logIndex: checkpoint.lastProcessedLogIndex,
              }
            : null,
        ),
      env.EVENT_SYNC_RPC_RETRIES,
      env.EVENT_SYNC_RPC_RETRY_DELAY_MS,
    );
    const blockTimestampCache = new Map<string, Date | null>();

    let processedEvents = 0;
    let processedProjectCreated = 0;
    let processedProjectFunded = 0;
    let lastCheckpointLogIndex: number | null = null;
    let lastCheckpointBlock: bigint = toBlock;

    for (const eventLog of orderedLogs) {
      const blockDate = await getBlockTimestampCached(
        client,
        eventLog.blockNumber,
        blockTimestampCache,
      );
      await prisma.$transaction(async (tx) => {
        let projectId: string | null = null;
        if (eventLog.name === "ProjectCreated") {
          projectId = await syncProjectCreated(tx, chainId, contractAddress, eventLog);
          processedProjectCreated += 1;
        } else {
          projectId = await syncProjectFunded(tx, chainId, contractAddress, eventLog);
          processedProjectFunded += 1;
        }

        await tx.transactionLog.upsert({
          where: {
            chainId_txHash_logIndex: {
              chainId,
              txHash: eventLog.txHash.toLowerCase(),
              logIndex: eventLog.logIndex,
            },
          },
          update: {
            blockNumber: eventLog.blockNumber,
            eventName: eventLog.name,
            projectId,
            payload: toTxPayload(eventLog, blockDate),
          },
          create: {
            chainId,
            blockNumber: eventLog.blockNumber,
            txHash: eventLog.txHash.toLowerCase(),
            logIndex: eventLog.logIndex,
            eventName: eventLog.name,
            projectId,
            fromAddress: eventLog.args.client.toLowerCase(),
            toAddress: contractAddress.toLowerCase(),
            payload: toTxPayload(eventLog, blockDate),
          },
        });

        await tx.eventSyncCheckpoint.upsert({
          where: { chainId_scope: { chainId, scope } },
          update: {
            lastProcessedBlock: eventLog.blockNumber,
            lastProcessedBlockHash: eventLog.blockHash,
            lastProcessedLogIndex: eventLog.logIndex,
            lastError: null,
            lastSuccessAt: new Date(),
          },
          create: {
            chainId,
            scope,
            lastProcessedBlock: eventLog.blockNumber,
            lastProcessedBlockHash: eventLog.blockHash,
            lastProcessedLogIndex: eventLog.logIndex,
            lastError: null,
            lastSuccessAt: new Date(),
          },
        });
      });

      processedEvents += 1;
      lastCheckpointBlock = eventLog.blockNumber;
      lastCheckpointLogIndex = eventLog.logIndex;
    }

    if (orderedLogs.length === 0) {
      const block = await client.getBlock({ blockNumber: toBlock });
      await prisma.eventSyncCheckpoint.upsert({
        where: { chainId_scope: { chainId, scope } },
        update: {
          lastProcessedBlock: toBlock,
          lastProcessedBlockHash: block.hash,
          lastProcessedLogIndex: null,
          lastError: null,
          lastSuccessAt: new Date(),
        },
        create: {
          chainId,
          scope,
          lastProcessedBlock: toBlock,
          lastProcessedBlockHash: block.hash,
          lastProcessedLogIndex: null,
          lastError: null,
          lastSuccessAt: new Date(),
        },
      });
      lastCheckpointBlock = toBlock;
      lastCheckpointLogIndex = null;
    }

    const result: EventSyncRunResult = {
      chainId,
      scope,
      fromBlock: cursor.fromBlock.toString(),
      toBlock: toBlock.toString(),
      safeHeadBlock: safeHead.toString(),
      processedEvents,
      processedProjectCreated,
      processedProjectFunded,
      checkpointBlock: lastCheckpointBlock.toString(),
      checkpointLogIndex: lastCheckpointLogIndex,
    };
    logger.info("Event sync batch completed", result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    await prisma.eventSyncCheckpoint.upsert({
      where: { chainId_scope: { chainId, scope } },
      update: { lastError: message },
      create: {
        chainId,
        scope,
        lastProcessedBlock: BigInt(Math.max(0, env.EVENT_SYNC_START_BLOCK)),
        lastProcessedLogIndex: -1,
        lastError: message,
      },
    });
    logger.error("Event sync batch failed", { error: message, chainId, scope });
    throw error;
  }
}

function deriveCursor(
  checkpoint: { lastProcessedBlock: bigint; lastProcessedLogIndex: number | null } | null,
  startBlock: number,
): { fromBlock: bigint } {
  if (!checkpoint) {
    return { fromBlock: BigInt(startBlock) };
  }
  if (checkpoint.lastProcessedLogIndex === null) {
    return { fromBlock: checkpoint.lastProcessedBlock + 1n };
  }
  return { fromBlock: checkpoint.lastProcessedBlock };
}

async function getSafeHeadBlock(
  client: ReturnType<typeof createPublicClient>,
  confirmations: number,
): Promise<bigint> {
  const latest = await client.getBlockNumber();
  const offset = BigInt(Math.max(0, confirmations));
  return latest > offset ? latest - offset : 0n;
}

async function fetchSupportedLogs(
  client: ReturnType<typeof createPublicClient>,
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  checkpointCursor: { blockNumber: bigint; logIndex: number | null } | null,
): Promise<SupportedEventLog[]> {
  const [createdLogs, fundedLogs] = await Promise.all([
    client.getLogs({
      address,
      event: projectCreatedEvent,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address,
      event: projectFundedEvent,
      fromBlock,
      toBlock,
    }),
  ]);

  const logs: SupportedEventLog[] = [
    ...createdLogs.map(
      (log): SupportedEventLog => ({
        name: "ProjectCreated",
        blockNumber: log.blockNumber ?? 0n,
        blockHash: log.blockHash,
        txHash: log.transactionHash as `0x${string}`,
        logIndex: log.logIndex ?? -1,
        args: {
          projectId: log.args.projectId ?? 0n,
          client: log.args.client ?? "0x0000000000000000000000000000000000000000",
          freelancer: log.args.freelancer ?? "0x0000000000000000000000000000000000000000",
          token: log.args.token ?? "0x0000000000000000000000000000000000000000",
          totalAmount: log.args.totalAmount ?? 0n,
          metadataURI: log.args.metadataURI ?? "",
          milestoneCount: log.args.milestoneCount ?? 0n,
        },
      }),
    ),
    ...fundedLogs.map(
      (log): SupportedEventLog => ({
        name: "ProjectFunded",
        blockNumber: log.blockNumber ?? 0n,
        blockHash: log.blockHash,
        txHash: log.transactionHash as `0x${string}`,
        logIndex: log.logIndex ?? -1,
        args: {
          projectId: log.args.projectId ?? 0n,
          client: log.args.client ?? "0x0000000000000000000000000000000000000000",
          token: log.args.token ?? "0x0000000000000000000000000000000000000000",
          amount: log.args.amount ?? 0n,
          fundedAmountAfter: log.args.fundedAmountAfter ?? 0n,
        },
      }),
    ),
  ];

  const filtered = logs.filter((entry) => {
    if (!checkpointCursor || checkpointCursor.logIndex === null) {
      return true;
    }
    if (entry.blockNumber !== checkpointCursor.blockNumber) {
      return true;
    }
    return entry.logIndex > checkpointCursor.logIndex;
  });

  return filtered.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    return a.logIndex - b.logIndex;
  });
}

async function syncProjectCreated(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: Extract<SupportedEventLog, { name: "ProjectCreated" }>,
): Promise<string | null> {
  const onChainProjectId = eventLog.args.projectId.toString();
  const contract = contractAddress.toLowerCase();
  const clientAddress = eventLog.args.client.toLowerCase();
  const freelancerAddress = eventLog.args.freelancer.toLowerCase();
  const tokenAddress = eventLog.args.token.toLowerCase();

  const existing = await tx.project.findFirst({
    where: {
      chainId,
      escrowContractAddress: contract,
      onChainProjectId,
    },
    select: { id: true, status: true },
  });
  if (existing) {
    await tx.project.update({
      where: { id: existing.id },
      data: {
        status:
          existing.status === ProjectStatus.DRAFT ||
          existing.status === ProjectStatus.AWAITING_FREELANCER ||
          existing.status === ProjectStatus.AWAITING_ESCROW
            ? ProjectStatus.AWAITING_ESCROW
            : existing.status,
        visibility: ProjectVisibility.PRIVATE,
        chainId,
        escrowContractAddress: contract,
        onChainProjectId,
        paymentTokenAddress: tokenAddress,
        agreementIpfsUri: eventLog.args.metadataURI || null,
        totalValueWei: eventLog.args.totalAmount.toString(),
      },
    });
    return existing.id;
  }

  const clientUser = await tx.user.findUnique({
    where: { walletAddress: clientAddress },
    select: { id: true },
  });
  if (!clientUser) {
    return null;
  }

  const freelancerUser = await tx.user.findUnique({
    where: { walletAddress: freelancerAddress },
    select: { id: true },
  });

  const created = await tx.project.create({
    data: {
      clientUserId: clientUser.id,
      freelancerUserId: freelancerUser?.id ?? null,
      status: ProjectStatus.AWAITING_ESCROW,
      visibility: ProjectVisibility.PRIVATE,
      title: `On-chain project #${onChainProjectId}`,
      description: "Imported from on-chain event sync.",
      agreementIpfsUri: eventLog.args.metadataURI || null,
      chainId,
      escrowContractAddress: contract,
      onChainProjectId,
      paymentTokenAddress: tokenAddress,
      totalValueWei: eventLog.args.totalAmount.toString(),
    },
    select: { id: true },
  });

  return created.id;
}

async function syncProjectFunded(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: Extract<SupportedEventLog, { name: "ProjectFunded" }>,
): Promise<string | null> {
  const onChainProjectId = eventLog.args.projectId.toString();
  const project = await tx.project.findFirst({
    where: {
      chainId,
      escrowContractAddress: contractAddress.toLowerCase(),
      onChainProjectId,
    },
    select: { id: true, totalValueWei: true, status: true },
  });
  if (!project) {
    return null;
  }

  const fundedAmount = eventLog.args.fundedAmountAfter;
  const targetAmount = project.totalValueWei ? BigInt(project.totalValueWei) : null;
  const computedStatus =
    targetAmount !== null && fundedAmount >= targetAmount
      ? ProjectStatus.ACTIVE
      : ProjectStatus.AWAITING_ESCROW;
  const finalStatus = preserveTerminalStatus(project.status, computedStatus);

  await tx.project.update({
    where: { id: project.id },
    data: {
      paymentTokenAddress: eventLog.args.token.toLowerCase(),
      status: finalStatus,
    },
  });

  return project.id;
}

function preserveTerminalStatus(
  current: ProjectStatus,
  computed: ProjectStatus,
): ProjectStatus {
  if (
    current === ProjectStatus.COMPLETED ||
    current === ProjectStatus.CANCELLED ||
    current === ProjectStatus.DISPUTED
  ) {
    return current;
  }
  return computed;
}

function toTxPayload(eventLog: SupportedEventLog, blockTimestamp: Date | null): Prisma.JsonObject {
  const base = {
    eventType: eventLog.name,
    contractProjectId: eventLog.args.projectId.toString(),
    blockTimestamp: blockTimestamp?.toISOString() ?? null,
    blockTimestampUnixSeconds: blockTimestamp
      ? Math.floor(blockTimestamp.getTime() / 1000)
      : null,
  } satisfies Prisma.JsonObject;

  if (eventLog.name === "ProjectCreated") {
    return {
      ...base,
      client: eventLog.args.client.toLowerCase(),
      freelancer: eventLog.args.freelancer.toLowerCase(),
      token: eventLog.args.token.toLowerCase(),
      totalAmount: eventLog.args.totalAmount.toString(),
      metadataURI: eventLog.args.metadataURI,
      milestoneCount: eventLog.args.milestoneCount.toString(),
    } satisfies Prisma.JsonObject;
  }
  return {
    ...base,
    client: eventLog.args.client.toLowerCase(),
    token: eventLog.args.token.toLowerCase(),
    amount: eventLog.args.amount.toString(),
    fundedAmountAfter: eventLog.args.fundedAmountAfter.toString(),
  } satisfies Prisma.JsonObject;
}

async function getBlockTimestampCached(
  client: ReturnType<typeof createPublicClient>,
  blockNumber: bigint,
  cache: Map<string, Date | null>,
): Promise<Date | null> {
  const key = blockNumber.toString();
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const block = await client.getBlock({ blockNumber });
    const timestamp = new Date(Number(block.timestamp) * 1000);
    cache.set(key, timestamp);
    return timestamp;
  } catch {
    cache.set(key, null);
    return null;
  }
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

async function withRetries<T>(
  action: () => Promise<T>,
  retries: number,
  delayMs: number,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      await sleep(delayMs * (attempt + 1));
      attempt += 1;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
