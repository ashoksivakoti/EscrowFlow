import "server-only";

import {
  DisputeStatus,
  MilestoneStatus,
  ProjectStatus,
  ProjectVisibility,
  Prisma,
  SubmissionStatus,
  TransactionLogSourceType,
} from "@prisma/client";
import { createPublicClient, decodeEventLog, getAddress, http, keccak256, stringToHex, type Log } from "viem";

import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { createLogger } from "@/server/logging/logger";
import { getEventSyncEnv } from "@/server/event-sync/env";
import { milestoneFundingSyncUpdates } from "@/server/services/funding-service";

const DEPRECATED_ESCROW_REGISTRY_ADDRESS =
  "0x268993a0e0342972a52c58aa2dd1a9953fd57acf";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ARBITRATOR_ROLE = keccak256(stringToHex("ARBITRATOR_ROLE")).toLowerCase();

export const REQUIRED_EVENT_NAMES = [
  "ProjectCreated",
  "ProjectFunded",
  "MilestoneSubmitted",
  "MilestoneApproved",
  "MilestoneFundsReleased",
  "DisputeRaised",
  "DisputeEvidenceAppended",
  "DisputeResolved",
  "DisputePayoutRecipients",
  "TokenReviewAttested",
  "AllowedTokenUpdated",
  "ProjectCancelled",
  "ProjectEmergencyCancelled",
  "EmergencyDisputeResolutionProposed",
  "EmergencyDisputeResolutionCancelled",
  "EmergencyDisputeResolved",
  "AlternativeRecipientSet",
  "AlternativeRecipientExecuted",
  "ArbitratorThresholdUpdated",
  "ArbitratorActionConfirmed",
  "RoleAdminChanged",
  "RoleGranted",
  "RoleRevoked",
  "Paused",
  "Unpaused",
] as const;

export const OPTIONAL_EVENT_NAMES = ["EmergencyDisputeResolutionNonceAdvanced"] as const;

const supportedEventNames = new Set<string>([
  ...REQUIRED_EVENT_NAMES,
  ...OPTIONAL_EVENT_NAMES,
]);

type SupportedEventName =
  | (typeof REQUIRED_EVENT_NAMES)[number]
  | (typeof OPTIONAL_EVENT_NAMES)[number];

type SupportedEventLog = {
  name: SupportedEventName;
  blockNumber: bigint;
  blockHash: `0x${string}` | null;
  txHash: `0x${string}`;
  logIndex: number;
  args: Record<string, unknown>;
};

type ProjectionState = Prisma.JsonObject;

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

export type ContractPauseSnapshot = {
  chainId: number;
  contractAddress: string;
  paused: boolean;
  eventName: "Paused" | "Unpaused";
  updatedBy: string | null;
  lastChangedBlock: string;
  lastChangedTxHash: string;
  lastChangedLogIndex: number;
  lastChangedAt: string | null;
} | null;

export async function syncEscrowEventsOnce(): Promise<EventSyncRunResult> {
  const env = getEventSyncEnv();
  const logger = createLogger("event-sync.escrow");
  const chainId = env.EVENT_SYNC_CHAIN_ID;
  const contractAddress = env.EVENT_SYNC_CONTRACT_ADDRESS as `0x${string}`;
  if (contractAddress.toLowerCase() === DEPRECATED_ESCROW_REGISTRY_ADDRESS) {
    throw new Error("Event sync cannot run against deprecated EscrowFlowRegistry address");
  }
  const scope = env.EVENT_SYNC_SCOPE ?? `ESCROW_REGISTRY:${contractAddress}`;

  const client = createPublicClient({
    transport: http(env.EVENT_SYNC_RPC_URL),
  });

  const safeHead = await getSafeHeadBlock(client, env.EVENT_SYNC_CONFIRMATIONS);
  const checkpoint = await prisma.eventSyncCheckpoint.findUnique({
    where: { chainId_scope: { chainId, scope } },
    select: {
      lastProcessedBlock: true,
      lastProcessedBlockHash: true,
      lastProcessedLogIndex: true,
      cursorState: true,
    },
  });
  const normalizedCheckpoint = await ensureCheckpointConsistency({
    client,
    env,
    chainId,
    scope,
    contractAddress,
    safeHead,
    checkpoint,
    logger,
  });
  const cursor = deriveCursor(normalizedCheckpoint, env.EVENT_SYNC_START_BLOCK);
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
      checkpointBlock: normalizedCheckpoint?.lastProcessedBlock.toString() ?? null,
      checkpointLogIndex: normalizedCheckpoint?.lastProcessedLogIndex ?? null,
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
          normalizedCheckpoint
            ? {
                blockNumber: normalizedCheckpoint.lastProcessedBlock,
                logIndex: normalizedCheckpoint.lastProcessedLogIndex,
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
    let projectionState: ProjectionState = isJsonObject(normalizedCheckpoint?.cursorState)
      ? normalizedCheckpoint.cursorState
      : {};

    for (const eventLog of orderedLogs) {
      const blockDate = await getBlockTimestampCached(
        client,
        eventLog.blockNumber,
        blockTimestampCache,
      );
      let nextProjectionState = projectionState;
      await prisma.$transaction(async (tx) => {
        const existingLog = await tx.transactionLog.findUnique({
          where: {
            chainId_txHash_logIndex: {
              chainId,
              txHash: eventLog.txHash.toLowerCase(),
              logIndex: eventLog.logIndex,
            },
          },
          select: { eventName: true, projectId: true },
        });
        const shouldApply = shouldApplyProjection(existingLog?.eventName ?? null, eventLog.name);

        let projectId: string | null = existingLog?.projectId ?? null;
        if (shouldApply) {
          const projectionResult = await applyEventProjection(tx, {
            chainId,
            contractAddress,
            eventLog,
            blockDate,
          });
          projectId = projectionResult.projectId;
          nextProjectionState = mergeProjectionState(projectionState, projectionResult.statePatch);
          if (eventLog.name === "ProjectCreated") {
            processedProjectCreated += 1;
          } else if (eventLog.name === "ProjectFunded") {
            processedProjectFunded += 1;
          }
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
            sourceType: TransactionLogSourceType.chain_event,
            projectId,
            payload: toTxPayload(eventLog, blockDate),
          },
          create: {
            chainId,
            blockNumber: eventLog.blockNumber,
            txHash: eventLog.txHash.toLowerCase(),
            logIndex: eventLog.logIndex,
            eventName: eventLog.name,
            sourceType: TransactionLogSourceType.chain_event,
            projectId,
            fromAddress: inferFromAddress(eventLog),
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
            cursorState: nextProjectionState,
            lastError: null,
            lastSuccessAt: new Date(),
          },
          create: {
            chainId,
            scope,
            lastProcessedBlock: eventLog.blockNumber,
            lastProcessedBlockHash: eventLog.blockHash,
            lastProcessedLogIndex: eventLog.logIndex,
            cursorState: nextProjectionState,
            lastError: null,
            lastSuccessAt: new Date(),
          },
        });
      });
      projectionState = nextProjectionState;

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

async function ensureCheckpointConsistency(input: {
  client: ReturnType<typeof createPublicClient>;
  env: EventSyncEnvLike;
  chainId: number;
  scope: string;
  contractAddress: `0x${string}`;
  safeHead: bigint;
  checkpoint: {
    lastProcessedBlock: bigint;
    lastProcessedBlockHash: string | null;
    lastProcessedLogIndex: number | null;
    cursorState: Prisma.JsonValue | null;
  } | null;
  logger: ReturnType<typeof createLogger>;
}): Promise<{
  lastProcessedBlock: bigint;
  lastProcessedBlockHash: string | null;
  lastProcessedLogIndex: number | null;
  cursorState: Prisma.JsonValue | null;
} | null> {
  const { checkpoint, safeHead, client } = input;
  if (!checkpoint || !checkpoint.lastProcessedBlockHash) {
    return checkpoint;
  }
  if (checkpoint.lastProcessedBlock > safeHead) {
    return checkpoint;
  }
  const chainBlock = await client.getBlock({ blockNumber: checkpoint.lastProcessedBlock });
  if (!isBlockHashMismatch(checkpoint.lastProcessedBlockHash, chainBlock.hash ?? null)) {
    return checkpoint;
  }

  const rewindFromBlock = computeRewindFromBlock({
    startBlock: input.env.EVENT_SYNC_START_BLOCK,
    lastProcessedBlock: checkpoint.lastProcessedBlock,
    rewindDepth: input.env.EVENT_SYNC_REWIND_DEPTH,
  });
  input.logger.warn("Detected reorg mismatch; rewinding checkpoint", {
    chainId: input.chainId,
    scope: input.scope,
    lastProcessedBlock: checkpoint.lastProcessedBlock.toString(),
    storedHash: checkpoint.lastProcessedBlockHash,
    chainHash: chainBlock.hash ?? null,
    rewindFromBlock: rewindFromBlock.toString(),
  });

  return prisma.$transaction(
    async (tx) => {
      const rebuilt = await rewindAndRebuildProjections(tx, {
        chainId: input.chainId,
        scope: input.scope,
        contractAddress: input.contractAddress,
        startBlock: BigInt(input.env.EVENT_SYNC_START_BLOCK),
        rewindFromBlock,
      });
      return rebuilt;
    },
    prismaInteractiveTransactionOptions,
  );
}

type EventSyncEnvLike = {
  EVENT_SYNC_START_BLOCK: number;
  EVENT_SYNC_REWIND_DEPTH: number;
};

function computeRewindFromBlock(input: {
  startBlock: number;
  lastProcessedBlock: bigint;
  rewindDepth: number;
}): bigint {
  const start = BigInt(input.startBlock);
  const depth = BigInt(Math.max(1, input.rewindDepth));
  const candidate = input.lastProcessedBlock - depth;
  return candidate > start ? candidate : start;
}

function isBlockHashMismatch(storedHash: string | null, chainHash: string | null): boolean {
  if (!storedHash || !chainHash) return false;
  return storedHash.toLowerCase() !== chainHash.toLowerCase();
}

async function rewindAndRebuildProjections(
  tx: Prisma.TransactionClient,
  input: {
    chainId: number;
    scope: string;
    contractAddress: `0x${string}`;
    startBlock: bigint;
    rewindFromBlock: bigint;
  },
): Promise<{
  lastProcessedBlock: bigint;
  lastProcessedBlockHash: string | null;
  lastProcessedLogIndex: number | null;
  cursorState: Prisma.JsonValue | null;
}> {
  const contractAddressLower = input.contractAddress.toLowerCase();
  await tx.transactionLog.deleteMany({
    where: {
      chainId: input.chainId,
      sourceType: TransactionLogSourceType.chain_event,
      toAddress: contractAddressLower,
      blockNumber: { gte: input.rewindFromBlock },
    },
  });

  // Projection tables are deterministic from chain events; rebuild from retained logs.
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "contract_pause_states"
      WHERE "chainId" = ${input.chainId} AND "contractAddress" = ${contractAddressLower}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "emergency_resolution_proposals"
      WHERE "chainId" = ${input.chainId} AND "contractAddress" = ${contractAddressLower}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "alternative_recipient_states"
      WHERE "chainId" = ${input.chainId} AND "contractAddress" = ${contractAddressLower}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "token_governance_states"
      WHERE "chainId" = ${input.chainId} AND "contractAddress" = ${contractAddressLower}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "role_membership_states"
      WHERE "chainId" = ${input.chainId} AND "contractAddress" = ${contractAddressLower}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "role_governance_events"
      WHERE "chainId" = ${input.chainId} AND "contractAddress" = ${contractAddressLower}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "arbitrator_governance_states"
      WHERE "chainId" = ${input.chainId} AND "contractAddress" = ${contractAddressLower}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      DELETE FROM "arbitrator_threshold_histories"
      WHERE "chainId" = ${input.chainId} AND "contractAddress" = ${contractAddressLower}
    `,
  );

  const retainedLogs = await tx.transactionLog.findMany({
    where: {
      chainId: input.chainId,
      sourceType: TransactionLogSourceType.chain_event,
      toAddress: contractAddressLower,
      blockNumber: { gte: input.startBlock, lt: input.rewindFromBlock },
    },
    select: {
      eventName: true,
      blockNumber: true,
      txHash: true,
      logIndex: true,
      payload: true,
    },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });

  let cursorState: ProjectionState = {};
  let lastProcessedBlock = input.startBlock > 0n ? input.startBlock - 1n : 0n;
  for (const row of retainedLogs) {
    const eventLog = parseStoredChainEventLog(row);
    if (!eventLog) continue;
    const blockDate = readBlockTimestampFromPayload(row.payload);
    await replayProjectionFromStoredLog(tx, {
      chainId: input.chainId,
      contractAddress: input.contractAddress,
      eventLog,
      blockDate,
    });
    cursorState = mergeProjectionState(cursorState, reduceProjectionState(eventLog));
    lastProcessedBlock = row.blockNumber;
  }

  const lastProcessedLogIndex = null;
  await tx.eventSyncCheckpoint.upsert({
    where: { chainId_scope: { chainId: input.chainId, scope: input.scope } },
    update: {
      lastProcessedBlock,
      lastProcessedBlockHash: null,
      lastProcessedLogIndex,
      cursorState,
      lastError: null,
      lastSuccessAt: new Date(),
    },
    create: {
      chainId: input.chainId,
      scope: input.scope,
      lastProcessedBlock,
      lastProcessedBlockHash: null,
      lastProcessedLogIndex,
      cursorState,
      lastError: null,
      lastSuccessAt: new Date(),
    },
  });

  return {
    lastProcessedBlock,
    lastProcessedBlockHash: null,
    lastProcessedLogIndex,
    cursorState,
  };
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
  const rawLogs = await client.getLogs({
    address,
    fromBlock,
    toBlock,
  });
  const logs = rawLogs
    .map((log) => parseSupportedEventLog(log))
    .filter((log): log is SupportedEventLog => Boolean(log));

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

export function parseSupportedEventLog(
  log: Pick<Log, "data" | "topics" | "blockNumber" | "blockHash" | "transactionHash" | "logIndex">,
): SupportedEventLog | null {
  try {
    const decoded = decodeEventLog({
      abi: escrowRegistryAbi,
      data: log.data,
      topics: log.topics,
      strict: false,
    });
    if (!supportedEventNames.has(decoded.eventName)) {
      return null;
    }
    return {
      name: decoded.eventName as SupportedEventName,
      blockNumber: log.blockNumber ?? 0n,
      blockHash: log.blockHash ?? null,
      txHash: (log.transactionHash ?? "0x") as `0x${string}`,
      logIndex: log.logIndex ?? -1,
      args: (decoded.args as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

async function syncProjectCreated(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
): Promise<string | null> {
  const projectId = asBigInt(eventLog.args.projectId);
  const client = asAddress(eventLog.args.client);
  const freelancer = asAddress(eventLog.args.freelancer);
  const token = asAddress(eventLog.args.token);
  const totalAmount = asBigInt(eventLog.args.totalAmount);
  const metadataURI = asString(eventLog.args.metadataURI);
  const onChainProjectId = projectId.toString();
  const contract = contractAddress.toLowerCase();
  const clientAddress = client.toLowerCase();
  const freelancerAddress = freelancer.toLowerCase();
  const tokenAddress = token.toLowerCase();

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
        agreementIpfsUri: metadataURI || null,
        totalValueWei: totalAmount.toString(),
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
      agreementIpfsUri: metadataURI || null,
      chainId,
      escrowContractAddress: contract,
      onChainProjectId,
      paymentTokenAddress: tokenAddress,
      totalValueWei: totalAmount.toString(),
    },
    select: { id: true },
  });

  return created.id;
}

async function syncProjectFunded(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
): Promise<string | null> {
  const projectId = asBigInt(eventLog.args.projectId);
  const token = asAddress(eventLog.args.token);
  const fundedAmountAfter = asBigInt(eventLog.args.fundedAmountAfter);
  const onChainProjectId = projectId.toString();
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

  const fundedAmount = fundedAmountAfter;
  const targetAmount = project.totalValueWei ? BigInt(project.totalValueWei) : null;
  const computedStatus =
    targetAmount !== null && fundedAmount >= targetAmount
      ? ProjectStatus.ACTIVE
      : ProjectStatus.AWAITING_ESCROW;
  const finalStatus = preserveTerminalStatus(project.status, computedStatus);

  await tx.project.update({
    where: { id: project.id },
    data: {
      paymentTokenAddress: token.toLowerCase(),
      status: finalStatus,
    },
  });

  const milestones = await tx.milestone.findMany({
    where: { projectId: project.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, sortOrder: true, status: true, amountWei: true, fundedAt: true },
  });
  const now = new Date();
  for (const row of milestoneFundingSyncUpdates(milestones, fundedAmount, now)) {
    await tx.milestone.update({
      where: { id: row.id },
      data: { status: row.status, fundedAt: row.fundedAt },
    });
  }

  return project.id;
}

async function resolveProjectIdForGenericEvent(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
): Promise<string | null> {
  const projectId = eventLog.args.projectId;
  if (typeof projectId !== "bigint") {
    return null;
  }
  const project = await tx.project.findFirst({
    where: {
      chainId,
      escrowContractAddress: contractAddress.toLowerCase(),
      onChainProjectId: projectId.toString(),
    },
    select: { id: true },
  });
  return project?.id ?? null;
}

async function applyEventProjection(
  tx: Prisma.TransactionClient,
  input: {
    chainId: number;
    contractAddress: `0x${string}`;
    eventLog: SupportedEventLog;
    blockDate: Date | null;
  },
): Promise<{ projectId: string | null; statePatch: ProjectionState }> {
  const { chainId, contractAddress, eventLog, blockDate } = input;
  if (eventLog.name === "ProjectCreated") {
    return {
      projectId: await syncProjectCreated(tx, chainId, contractAddress, eventLog),
      statePatch: {},
    };
  }
  if (eventLog.name === "ProjectFunded") {
    return {
      projectId: await syncProjectFunded(tx, chainId, contractAddress, eventLog),
      statePatch: {},
    };
  }
  if (eventLog.name === "MilestoneSubmitted") {
    return {
      projectId: await syncMilestoneSubmitted(tx, chainId, contractAddress, eventLog, blockDate),
      statePatch: {},
    };
  }
  if (eventLog.name === "MilestoneApproved") {
    return {
      projectId: await syncMilestoneApproved(tx, chainId, contractAddress, eventLog, blockDate),
      statePatch: {},
    };
  }
  if (eventLog.name === "MilestoneFundsReleased") {
    return {
      projectId: await syncMilestoneFundsReleased(tx, chainId, contractAddress, eventLog, blockDate),
      statePatch: {},
    };
  }
  if (eventLog.name === "DisputeRaised") {
    return {
      projectId: await syncDisputeRaised(tx, chainId, contractAddress, eventLog, blockDate),
      statePatch: {},
    };
  }
  if (eventLog.name === "DisputeEvidenceAppended") {
    return {
      projectId: await syncDisputeEvidenceAppended(tx, chainId, contractAddress, eventLog),
      statePatch: {},
    };
  }
  if (eventLog.name === "DisputeResolved" || eventLog.name === "EmergencyDisputeResolved") {
    if (eventLog.name === "EmergencyDisputeResolved") {
      await syncEmergencyResolutionProposal(tx, chainId, contractAddress, eventLog);
    }
    await syncAlternativeRecipientState(tx, chainId, contractAddress, eventLog);
    return {
      projectId: await syncDisputeResolved(tx, chainId, contractAddress, eventLog, blockDate),
      statePatch: {},
    };
  }
  if (eventLog.name === "ProjectCancelled" || eventLog.name === "ProjectEmergencyCancelled") {
    await syncAlternativeRecipientState(tx, chainId, contractAddress, eventLog);
    return {
      projectId: await syncProjectCancelled(tx, chainId, contractAddress, eventLog, blockDate),
      statePatch: {},
    };
  }
  if (eventLog.name === "AlternativeRecipientSet" || eventLog.name === "AlternativeRecipientExecuted") {
    const projectId = await syncAlternativeRecipientState(tx, chainId, contractAddress, eventLog);
    return {
      projectId,
      statePatch: reduceProjectionState(eventLog),
    };
  }
  if (
    eventLog.name === "EmergencyDisputeResolutionProposed" ||
    eventLog.name === "EmergencyDisputeResolutionCancelled" ||
    eventLog.name === "EmergencyDisputeResolutionNonceAdvanced"
  ) {
    const projectId = await syncEmergencyResolutionProposal(tx, chainId, contractAddress, eventLog);
    return {
      projectId,
      statePatch: reduceProjectionState(eventLog),
    };
  }
  if (eventLog.name === "TokenReviewAttested" || eventLog.name === "AllowedTokenUpdated") {
    await syncTokenGovernanceState(tx, chainId, contractAddress, eventLog);
    return {
      projectId: null,
      statePatch: reduceProjectionState(eventLog),
    };
  }
  if (
    eventLog.name === "RoleGranted" ||
    eventLog.name === "RoleRevoked" ||
    eventLog.name === "RoleAdminChanged" ||
    eventLog.name === "ArbitratorThresholdUpdated"
  ) {
    await syncRoleAndArbitratorGovernanceState(tx, chainId, contractAddress, eventLog);
    return {
      projectId: null,
      statePatch: reduceProjectionState(eventLog),
    };
  }
  if (eventLog.name === "Paused" || eventLog.name === "Unpaused") {
    await syncPauseStateProjection(tx, chainId, contractAddress, eventLog, blockDate);
    return {
      projectId: null,
      statePatch: reduceProjectionState(eventLog),
    };
  }
  return {
    projectId: await resolveProjectIdForGenericEvent(tx, chainId, contractAddress, eventLog),
    statePatch: reduceProjectionState(eventLog),
  };
}

async function findProjectByOnChainId(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  projectId: bigint,
): Promise<{ id: string; status: ProjectStatus } | null> {
  return tx.project.findFirst({
    where: {
      chainId,
      escrowContractAddress: contractAddress.toLowerCase(),
      onChainProjectId: projectId.toString(),
    },
    select: { id: true, status: true },
  });
}

async function findMilestoneByOnChainIndex(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  projectId: bigint,
  milestoneIndex: bigint,
): Promise<{ id: string; projectId: string; status: MilestoneStatus } | null> {
  return tx.milestone.findFirst({
    where: {
      sortOrder: Number(milestoneIndex),
      project: {
        chainId,
        escrowContractAddress: contractAddress.toLowerCase(),
        onChainProjectId: projectId.toString(),
      },
    },
    select: { id: true, projectId: true, status: true },
  });
}

async function syncMilestoneSubmitted(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
  blockDate: Date | null,
): Promise<string | null> {
  const contractProjectId = asBigInt(eventLog.args.projectId);
  const milestoneIndex = asBigInt(eventLog.args.milestoneIndex);
  const submissionUri = asString(eventLog.args.submissionURI);
  const milestone = await findMilestoneByOnChainIndex(
    tx,
    chainId,
    contractAddress,
    contractProjectId,
    milestoneIndex,
  );
  if (!milestone) return null;
  await tx.milestone.update({
    where: { id: milestone.id },
    data: { status: MilestoneStatus.SUBMITTED },
  });
  const existingSubmission = await tx.submission.findFirst({
    where: {
      milestoneId: milestone.id,
      deliverablesIpfsUri: submissionUri,
    },
    select: { id: true },
  });
  if (!existingSubmission) {
    const latestAttempt = await tx.submission.findFirst({
      where: { milestoneId: milestone.id },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });
    await tx.submission.create({
      data: {
        milestoneId: milestone.id,
        submittedByUserId: await resolveUserIdByAddress(tx, asAddress(eventLog.args.freelancer)),
        deliverablesIpfsUri: submissionUri || "ipfs://missing-submission-uri",
        status: SubmissionStatus.SUBMITTED,
        submittedAt: blockDate ?? new Date(),
        attemptNumber: (latestAttempt?.attemptNumber ?? 0) + 1,
      },
    });
  }
  await tx.project.update({
    where: { id: milestone.projectId },
    data: { status: ProjectStatus.ACTIVE },
  });
  return milestone.projectId;
}

async function syncMilestoneApproved(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
  blockDate: Date | null,
): Promise<string | null> {
  const contractProjectId = asBigInt(eventLog.args.projectId);
  const milestoneIndex = asBigInt(eventLog.args.milestoneIndex);
  const milestone = await findMilestoneByOnChainIndex(
    tx,
    chainId,
    contractAddress,
    contractProjectId,
    milestoneIndex,
  );
  if (!milestone) return null;
  await tx.milestone.update({
    where: { id: milestone.id },
    data: { status: MilestoneStatus.APPROVED },
  });
  const latestSubmission = await tx.submission.findFirst({
    where: { milestoneId: milestone.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (latestSubmission) {
    await tx.submission.update({
      where: { id: latestSubmission.id },
      data: { status: SubmissionStatus.ACCEPTED, decidedAt: blockDate ?? new Date() },
    });
  }
  return milestone.projectId;
}

async function syncMilestoneFundsReleased(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
  blockDate: Date | null,
): Promise<string | null> {
  const contractProjectId = asBigInt(eventLog.args.projectId);
  const milestoneIndex = asBigInt(eventLog.args.milestoneIndex);
  const milestone = await findMilestoneByOnChainIndex(
    tx,
    chainId,
    contractAddress,
    contractProjectId,
    milestoneIndex,
  );
  if (!milestone) return null;
  await tx.milestone.update({
    where: { id: milestone.id },
    data: { status: MilestoneStatus.RELEASED, releasedAt: blockDate ?? new Date() },
  });
  const remaining = await tx.milestone.count({
    where: {
      projectId: milestone.projectId,
      status: { notIn: [MilestoneStatus.RELEASED, MilestoneStatus.VOIDED] },
    },
  });
  await tx.project.update({
    where: { id: milestone.projectId },
    data: { status: remaining === 0 ? ProjectStatus.COMPLETED : ProjectStatus.ACTIVE },
  });
  return milestone.projectId;
}

async function syncDisputeRaised(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
  blockDate: Date | null,
): Promise<string | null> {
  const contractProjectId = asBigInt(eventLog.args.projectId);
  const milestoneIndex = asBigInt(eventLog.args.milestoneIndex);
  const reasonURI = asString(eventLog.args.reasonURI);
  const milestone = await findMilestoneByOnChainIndex(
    tx,
    chainId,
    contractAddress,
    contractProjectId,
    milestoneIndex,
  );
  if (!milestone) return null;
  const existing = await tx.dispute.findFirst({
    where: {
      milestoneId: milestone.id,
      status: { in: [DisputeStatus.OPEN, DisputeStatus.AWAITING_RESPONSE, DisputeStatus.UNDER_ADMIN_REVIEW] },
    },
    select: { id: true },
  });
  if (!existing) {
    await tx.dispute.create({
      data: {
        milestoneId: milestone.id,
        openedByUserId: await resolveUserIdByAddress(tx, asAddress(eventLog.args.raisedBy)),
        status: DisputeStatus.OPEN,
        title: "On-chain dispute",
        description: reasonURI || "On-chain dispute raised",
        evidenceIpfsUri: reasonURI || "ipfs://missing-dispute-uri",
        createdAt: blockDate ?? undefined,
      },
    });
  }
  await tx.milestone.update({ where: { id: milestone.id }, data: { status: MilestoneStatus.DISPUTED } });
  await tx.project.update({ where: { id: milestone.projectId }, data: { status: ProjectStatus.DISPUTED } });
  return milestone.projectId;
}

async function syncDisputeEvidenceAppended(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
): Promise<string | null> {
  const contractProjectId = asBigInt(eventLog.args.projectId);
  const milestoneIndex = asBigInt(eventLog.args.milestoneIndex);
  const evidenceURI = asString(eventLog.args.evidenceURI);
  const milestone = await findMilestoneByOnChainIndex(
    tx,
    chainId,
    contractAddress,
    contractProjectId,
    milestoneIndex,
  );
  if (!milestone) return null;
  const dispute = await tx.dispute.findFirst({
    where: {
      milestoneId: milestone.id,
      status: { in: [DisputeStatus.OPEN, DisputeStatus.AWAITING_RESPONSE, DisputeStatus.UNDER_ADMIN_REVIEW] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (dispute && evidenceURI) {
    await tx.dispute.update({
      where: { id: dispute.id },
      data: { evidenceIpfsUri: evidenceURI },
    });
  }
  return milestone.projectId;
}

async function syncDisputeResolved(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
  blockDate: Date | null,
): Promise<string | null> {
  const contractProjectId = asBigInt(eventLog.args.projectId);
  const milestoneIndex = asBigInt(eventLog.args.milestoneIndex);
  const resolutionKind = Number(asBigInt(eventLog.args.resolutionKind));
  const milestone = await findMilestoneByOnChainIndex(
    tx,
    chainId,
    contractAddress,
    contractProjectId,
    milestoneIndex,
  );
  if (!milestone) return null;
  const dispute = await tx.dispute.findFirst({
    where: {
      milestoneId: milestone.id,
      status: { in: [DisputeStatus.OPEN, DisputeStatus.AWAITING_RESPONSE, DisputeStatus.UNDER_ADMIN_REVIEW] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (dispute) {
    await tx.dispute.update({
      where: { id: dispute.id },
      data: {
        status:
          resolutionKind === 0
            ? DisputeStatus.RESOLVED_FREELANCER_FAVOR
            : resolutionKind === 1
              ? DisputeStatus.RESOLVED_CLIENT_FAVOR
              : DisputeStatus.RESOLVED_SPLIT,
        resolvedAt: blockDate ?? new Date(),
      },
    });
  }
  await tx.milestone.update({
    where: { id: milestone.id },
    data: { status: resolutionKind === 1 ? MilestoneStatus.VOIDED : MilestoneStatus.RELEASED, releasedAt: blockDate ?? new Date() },
  });
  const openDisputes = await tx.dispute.count({
    where: {
      milestone: { projectId: milestone.projectId },
      status: { in: [DisputeStatus.OPEN, DisputeStatus.AWAITING_RESPONSE, DisputeStatus.UNDER_ADMIN_REVIEW] },
    },
  });
  const unresolvedMilestones = await tx.milestone.count({
    where: {
      projectId: milestone.projectId,
      status: { notIn: [MilestoneStatus.RELEASED, MilestoneStatus.VOIDED] },
    },
  });
  await tx.project.update({
    where: { id: milestone.projectId },
    data: {
      status:
        openDisputes > 0
          ? ProjectStatus.DISPUTED
          : unresolvedMilestones === 0
            ? ProjectStatus.COMPLETED
            : ProjectStatus.ACTIVE,
    },
  });
  return milestone.projectId;
}

async function syncProjectCancelled(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
  blockDate: Date | null,
): Promise<string | null> {
  const contractProjectId = asBigInt(eventLog.args.projectId);
  const project = await findProjectByOnChainId(tx, chainId, contractAddress, contractProjectId);
  if (!project) return null;
  await tx.project.update({
    where: { id: project.id },
    data: { status: ProjectStatus.CANCELLED, cancelledAt: blockDate ?? new Date() },
  });
  await tx.milestone.updateMany({
    where: {
      projectId: project.id,
      status: { in: [MilestoneStatus.PLANNED, MilestoneStatus.AWAITING_FUNDS, MilestoneStatus.FUNDED, MilestoneStatus.IN_PROGRESS, MilestoneStatus.SUBMITTED, MilestoneStatus.CLIENT_REVIEW, MilestoneStatus.APPROVED, MilestoneStatus.DISPUTED] },
    },
    data: { status: MilestoneStatus.VOIDED },
  });
  return project.id;
}

async function syncPauseStateProjection(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
  blockDate: Date | null,
): Promise<void> {
  const paused = eventLog.name === "Paused";
  const updatedBy = asAddress(eventLog.args.account).toLowerCase();
  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "contract_pause_states" (
        "id",
        "chainId",
        "contractAddress",
        "paused",
        "eventName",
        "updatedBy",
        "lastChangedBlock",
        "lastChangedTxHash",
        "lastChangedLogIndex",
        "lastChangedAt",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${`${chainId}:${contractAddress.toLowerCase()}:${eventLog.txHash.toLowerCase()}:${eventLog.logIndex}`},
        ${chainId},
        ${contractAddress.toLowerCase()},
        ${paused},
        ${eventLog.name},
        ${updatedBy},
        ${eventLog.blockNumber},
        ${eventLog.txHash.toLowerCase()},
        ${eventLog.logIndex},
        ${blockDate ?? null},
        NOW(),
        NOW()
      )
      ON CONFLICT ("chainId", "contractAddress")
      DO UPDATE SET
        "paused" = EXCLUDED."paused",
        "eventName" = EXCLUDED."eventName",
        "updatedBy" = EXCLUDED."updatedBy",
        "lastChangedBlock" = EXCLUDED."lastChangedBlock",
        "lastChangedTxHash" = EXCLUDED."lastChangedTxHash",
        "lastChangedLogIndex" = EXCLUDED."lastChangedLogIndex",
        "lastChangedAt" = EXCLUDED."lastChangedAt",
        "updatedAt" = NOW()
    `,
  );
}

async function syncEmergencyResolutionProposal(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
): Promise<string | null> {
  const projectIdBigInt = asBigInt(eventLog.args.projectId);
  const milestoneIndexBigInt = asBigInt(eventLog.args.milestoneIndex);
  const projectDb = await findProjectByOnChainId(
    tx,
    chainId,
    contractAddress,
    projectIdBigInt,
  );
  const projectDbId = projectDb?.id ?? null;
  const projectId = projectIdBigInt.toString();
  const milestoneIndex = Number(milestoneIndexBigInt);
  const contractAddressLower = contractAddress.toLowerCase();
  const txHashLower = eventLog.txHash.toLowerCase();

  if (eventLog.name === "EmergencyDisputeResolutionProposed") {
    const readyAtSeconds = Number(asBigInt(eventLog.args.readyAt));
    const readyAt = Number.isFinite(readyAtSeconds) && readyAtSeconds > 0
      ? new Date(readyAtSeconds * 1000)
      : null;
    await tx.emergencyResolutionProposal.upsert({
      where: {
        chainId_txHash_logIndex: {
          chainId,
          txHash: txHashLower,
          logIndex: eventLog.logIndex,
        },
      },
      update: {
        contractAddress: contractAddressLower,
        projectDbId,
        projectId,
        milestoneIndex,
        actionHash: asString(eventLog.args.actionHash),
        kind: Number(asBigInt(eventLog.args.resolutionKind)),
        freelancerAmount: asBigInt(eventLog.args.freelancerAmount).toString(),
        clientAmount: asBigInt(eventLog.args.clientAmount).toString(),
        readyAt,
        status: "proposed",
      },
      create: {
        chainId,
        contractAddress: contractAddressLower,
        projectDbId,
        projectId,
        milestoneIndex,
        actionHash: asString(eventLog.args.actionHash),
        kind: Number(asBigInt(eventLog.args.resolutionKind)),
        freelancerAmount: asBigInt(eventLog.args.freelancerAmount).toString(),
        clientAmount: asBigInt(eventLog.args.clientAmount).toString(),
        readyAt,
        status: "proposed",
        txHash: txHashLower,
        logIndex: eventLog.logIndex,
      },
    });
    return projectDbId;
  }

  if (eventLog.name === "EmergencyDisputeResolutionCancelled") {
    const actionHash = asString(eventLog.args.actionHash);
    if (actionHash) {
      await tx.emergencyResolutionProposal.updateMany({
        where: {
          chainId,
          contractAddress: contractAddressLower,
          projectId,
          milestoneIndex,
          actionHash,
          status: "proposed",
        },
        data: {
          status: "cancelled",
        },
      });
    }
    await tx.emergencyResolutionProposal.upsert({
      where: {
        chainId_txHash_logIndex: {
          chainId,
          txHash: txHashLower,
          logIndex: eventLog.logIndex,
        },
      },
      update: {
        contractAddress: contractAddressLower,
        projectDbId,
        projectId,
        milestoneIndex,
        actionHash: actionHash || null,
        status: "cancelled",
      },
      create: {
        chainId,
        contractAddress: contractAddressLower,
        projectDbId,
        projectId,
        milestoneIndex,
        actionHash: actionHash || null,
        kind: null,
        freelancerAmount: null,
        clientAmount: null,
        readyAt: null,
        status: "cancelled",
        txHash: txHashLower,
        logIndex: eventLog.logIndex,
      },
    });
    return projectDbId;
  }

  if (eventLog.name === "EmergencyDisputeResolved") {
    await tx.emergencyResolutionProposal.updateMany({
      where: {
        chainId,
        contractAddress: contractAddressLower,
        projectId,
        milestoneIndex,
        status: "proposed",
      },
      data: {
        status: "executed",
      },
    });
    await tx.emergencyResolutionProposal.upsert({
      where: {
        chainId_txHash_logIndex: {
          chainId,
          txHash: txHashLower,
          logIndex: eventLog.logIndex,
        },
      },
      update: {
        contractAddress: contractAddressLower,
        projectDbId,
        projectId,
        milestoneIndex,
        kind: Number(asBigInt(eventLog.args.resolutionKind)),
        freelancerAmount: asBigInt(eventLog.args.freelancerAmount).toString(),
        clientAmount: asBigInt(eventLog.args.clientAmount).toString(),
        readyAt: null,
        status: "executed",
      },
      create: {
        chainId,
        contractAddress: contractAddressLower,
        projectDbId,
        projectId,
        milestoneIndex,
        actionHash: null,
        kind: Number(asBigInt(eventLog.args.resolutionKind)),
        freelancerAmount: asBigInt(eventLog.args.freelancerAmount).toString(),
        clientAmount: asBigInt(eventLog.args.clientAmount).toString(),
        readyAt: null,
        status: "executed",
        txHash: txHashLower,
        logIndex: eventLog.logIndex,
      },
    });
    return projectDbId;
  }

  // EmergencyDisputeResolutionNonceAdvanced invalidates pending proposals.
  await tx.emergencyResolutionProposal.updateMany({
    where: {
      chainId,
      contractAddress: contractAddressLower,
      projectId,
      milestoneIndex,
      status: "proposed",
    },
    data: {
      status: "invalidated",
    },
  });
  await tx.emergencyResolutionProposal.upsert({
    where: {
      chainId_txHash_logIndex: {
        chainId,
        txHash: txHashLower,
        logIndex: eventLog.logIndex,
      },
    },
    update: {
      contractAddress: contractAddressLower,
      projectDbId,
      projectId,
      milestoneIndex,
      status: "invalidated",
    },
    create: {
      chainId,
      contractAddress: contractAddressLower,
      projectDbId,
      projectId,
      milestoneIndex,
      actionHash: null,
      kind: null,
      freelancerAmount: null,
      clientAmount: null,
      readyAt: null,
      status: "invalidated",
      txHash: txHashLower,
      logIndex: eventLog.logIndex,
    },
  });
  return projectDbId;
}

async function syncAlternativeRecipientState(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
): Promise<string | null> {
  const contractAddressLower = contractAddress.toLowerCase();
  const txHashLower = eventLog.txHash.toLowerCase();
  const projectId = asBigInt(eventLog.args.projectId).toString();
  const projectDb = await findProjectByOnChainId(tx, chainId, contractAddress, asBigInt(eventLog.args.projectId));
  const projectDbId = projectDb?.id ?? null;

  if (eventLog.name === "AlternativeRecipientSet" || eventLog.name === "AlternativeRecipientExecuted") {
    const milestoneIndex = Number(asBigInt(eventLog.args.milestoneIndex));
    const isFreelancer = Boolean(eventLog.args.isFreelancer);
    const recipient = asAddress(eventLog.args.recipient).toLowerCase();
    const executableAfter = asBigInt(eventLog.args.executableAfter);

    if (eventLog.name === "AlternativeRecipientSet") {
      const isZeroRecipient = recipient === ZERO_ADDRESS;
      const isPartyAuthorized = executableAfter === 0n;
      await tx.alternativeRecipientState.upsert({
        where: {
          chainId_contractAddress_projectId_milestoneIndex_isFreelancer: {
            chainId,
            contractAddress: contractAddressLower,
            projectId,
            milestoneIndex,
            isFreelancer,
          },
        },
        update: {
          projectDbId,
          pendingRecipient: !isPartyAuthorized && !isZeroRecipient ? recipient : null,
          executableAfter: !isPartyAuthorized && !isZeroRecipient ? executableAfter : null,
          activeRecipient: null,
          partyAuthorizedRecipient: isPartyAuthorized && !isZeroRecipient ? recipient : null,
          status: !isPartyAuthorized && !isZeroRecipient ? "pending" : "cleared",
          updatedAtBlock: eventLog.blockNumber,
          updatedAtTxHash: txHashLower,
          updatedAtLogIndex: eventLog.logIndex,
        },
        create: {
          chainId,
          contractAddress: contractAddressLower,
          projectDbId,
          projectId,
          milestoneIndex,
          isFreelancer,
          pendingRecipient: !isPartyAuthorized && !isZeroRecipient ? recipient : null,
          executableAfter: !isPartyAuthorized && !isZeroRecipient ? executableAfter : null,
          activeRecipient: null,
          partyAuthorizedRecipient: isPartyAuthorized && !isZeroRecipient ? recipient : null,
          status: !isPartyAuthorized && !isZeroRecipient ? "pending" : "cleared",
          updatedAtBlock: eventLog.blockNumber,
          updatedAtTxHash: txHashLower,
          updatedAtLogIndex: eventLog.logIndex,
        },
      });
      return projectDbId;
    }

    await tx.alternativeRecipientState.upsert({
      where: {
        chainId_contractAddress_projectId_milestoneIndex_isFreelancer: {
          chainId,
          contractAddress: contractAddressLower,
          projectId,
          milestoneIndex,
          isFreelancer,
        },
      },
      update: {
        projectDbId,
        pendingRecipient: null,
        executableAfter: null,
        activeRecipient: recipient === ZERO_ADDRESS ? null : recipient,
        status: recipient === ZERO_ADDRESS ? "cleared" : "active",
        updatedAtBlock: eventLog.blockNumber,
        updatedAtTxHash: txHashLower,
        updatedAtLogIndex: eventLog.logIndex,
      },
      create: {
        chainId,
        contractAddress: contractAddressLower,
        projectDbId,
        projectId,
        milestoneIndex,
        isFreelancer,
        pendingRecipient: null,
        executableAfter: null,
        activeRecipient: recipient === ZERO_ADDRESS ? null : recipient,
        partyAuthorizedRecipient: null,
        status: recipient === ZERO_ADDRESS ? "cleared" : "active",
        updatedAtBlock: eventLog.blockNumber,
        updatedAtTxHash: txHashLower,
        updatedAtLogIndex: eventLog.logIndex,
      },
    });
    return projectDbId;
  }

  if (eventLog.name === "DisputeResolved" || eventLog.name === "EmergencyDisputeResolved") {
    const milestoneIndex = Number(asBigInt(eventLog.args.milestoneIndex));
    for (const isFreelancer of [true, false]) {
      await tx.alternativeRecipientState.upsert({
        where: {
          chainId_contractAddress_projectId_milestoneIndex_isFreelancer: {
            chainId,
            contractAddress: contractAddressLower,
            projectId,
            milestoneIndex,
            isFreelancer,
          },
        },
        update: {
          projectDbId,
          pendingRecipient: null,
          executableAfter: null,
          activeRecipient: null,
          partyAuthorizedRecipient: null,
          status: "cleared",
          updatedAtBlock: eventLog.blockNumber,
          updatedAtTxHash: txHashLower,
          updatedAtLogIndex: eventLog.logIndex,
        },
        create: {
          chainId,
          contractAddress: contractAddressLower,
          projectDbId,
          projectId,
          milestoneIndex,
          isFreelancer,
          pendingRecipient: null,
          executableAfter: null,
          activeRecipient: null,
          partyAuthorizedRecipient: null,
          status: "cleared",
          updatedAtBlock: eventLog.blockNumber,
          updatedAtTxHash: txHashLower,
          updatedAtLogIndex: eventLog.logIndex,
        },
      });
    }
    return projectDbId;
  }

  // Project-level cancellation clears all milestone recipient legs.
  await tx.alternativeRecipientState.updateMany({
    where: {
      chainId,
      contractAddress: contractAddressLower,
      projectId,
    },
    data: {
      projectDbId,
      pendingRecipient: null,
      executableAfter: null,
      activeRecipient: null,
      partyAuthorizedRecipient: null,
      status: "cleared",
      updatedAtBlock: eventLog.blockNumber,
      updatedAtTxHash: txHashLower,
      updatedAtLogIndex: eventLog.logIndex,
    },
  });
  return projectDbId;
}

async function syncTokenGovernanceState(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
): Promise<void> {
  const token = asAddress(eventLog.args.token).toLowerCase();
  const contractAddressLower = contractAddress.toLowerCase();
  const txHashLower = eventLog.txHash.toLowerCase();

  if (eventLog.name === "TokenReviewAttested") {
    await tx.tokenGovernanceState.upsert({
      where: {
        chainId_contractAddress_token: {
          chainId,
          contractAddress: contractAddressLower,
          token,
        },
      },
      update: {
        reviewed: true,
        reviewedBy: asAddress(eventLog.args.admin).toLowerCase(),
        lastUpdatedTxHash: txHashLower,
        lastUpdatedBlock: eventLog.blockNumber,
        lastUpdatedLogIndex: eventLog.logIndex,
      },
      create: {
        chainId,
        contractAddress: contractAddressLower,
        token,
        reviewed: true,
        allowed: false,
        reviewedBy: asAddress(eventLog.args.admin).toLowerCase(),
        lastUpdatedTxHash: txHashLower,
        lastUpdatedBlock: eventLog.blockNumber,
        lastUpdatedLogIndex: eventLog.logIndex,
      },
    });
    return;
  }

  await tx.tokenGovernanceState.upsert({
    where: {
      chainId_contractAddress_token: {
        chainId,
        contractAddress: contractAddressLower,
        token,
      },
    },
    update: {
      allowed: Boolean(eventLog.args.allowed),
      lastUpdatedTxHash: txHashLower,
      lastUpdatedBlock: eventLog.blockNumber,
      lastUpdatedLogIndex: eventLog.logIndex,
    },
    create: {
      chainId,
      contractAddress: contractAddressLower,
      token,
      reviewed: false,
      allowed: Boolean(eventLog.args.allowed),
      reviewedBy: null,
      lastUpdatedTxHash: txHashLower,
      lastUpdatedBlock: eventLog.blockNumber,
      lastUpdatedLogIndex: eventLog.logIndex,
    },
  });
}

async function syncRoleAndArbitratorGovernanceState(
  tx: Prisma.TransactionClient,
  chainId: number,
  contractAddress: `0x${string}`,
  eventLog: SupportedEventLog,
): Promise<void> {
  const contractAddressLower = contractAddress.toLowerCase();
  const txHashLower = eventLog.txHash.toLowerCase();

  if (eventLog.name === "RoleGranted" || eventLog.name === "RoleRevoked") {
    const role = asBytes32(eventLog.args.role).toLowerCase();
    const account = asAddress(eventLog.args.account).toLowerCase();
    const sender = asAddress(eventLog.args.sender).toLowerCase();
    const isActive = eventLog.name === "RoleGranted";

    const existingMembership = await tx.roleMembershipState.findUnique({
      where: {
        chainId_contractAddress_role_account: {
          chainId,
          contractAddress: contractAddressLower,
          role,
          account,
        },
      },
      select: { isActive: true },
    });

    await tx.roleMembershipState.upsert({
      where: {
        chainId_contractAddress_role_account: {
          chainId,
          contractAddress: contractAddressLower,
          role,
          account,
        },
      },
      update: {
        isActive,
        lastUpdatedBy: sender,
        lastUpdatedTxHash: txHashLower,
        lastUpdatedBlock: eventLog.blockNumber,
        lastUpdatedLogIndex: eventLog.logIndex,
      },
      create: {
        chainId,
        contractAddress: contractAddressLower,
        role,
        account,
        isActive,
        lastUpdatedBy: sender,
        lastUpdatedTxHash: txHashLower,
        lastUpdatedBlock: eventLog.blockNumber,
        lastUpdatedLogIndex: eventLog.logIndex,
      },
    });

    await tx.roleGovernanceEvent.upsert({
      where: {
        chainId_txHash_logIndex: {
          chainId,
          txHash: txHashLower,
          logIndex: eventLog.logIndex,
        },
      },
      update: {
        contractAddress: contractAddressLower,
        eventType: eventLog.name === "RoleGranted" ? "role_granted" : "role_revoked",
        role,
        account,
        sender,
        previousAdminRole: null,
        newAdminRole: null,
        blockNumber: eventLog.blockNumber,
      },
      create: {
        chainId,
        contractAddress: contractAddressLower,
        eventType: eventLog.name === "RoleGranted" ? "role_granted" : "role_revoked",
        role,
        account,
        sender,
        previousAdminRole: null,
        newAdminRole: null,
        txHash: txHashLower,
        logIndex: eventLog.logIndex,
        blockNumber: eventLog.blockNumber,
      },
    });

    if (role === ARBITRATOR_ROLE && existingMembership?.isActive !== isActive) {
      const currentState = await tx.arbitratorGovernanceState.findUnique({
        where: {
          chainId_contractAddress: {
            chainId,
            contractAddress: contractAddressLower,
          },
        },
        select: { arbitratorCount: true, arbitratorThreshold: true },
      });
      const nextCount = Math.max(
        0,
        (currentState?.arbitratorCount ?? 0) + (isActive ? 1 : -1),
      );
      await tx.arbitratorGovernanceState.upsert({
        where: {
          chainId_contractAddress: {
            chainId,
            contractAddress: contractAddressLower,
          },
        },
        update: {
          arbitratorCount: nextCount,
          lastUpdatedTxHash: txHashLower,
          lastUpdatedBlock: eventLog.blockNumber,
          lastUpdatedLogIndex: eventLog.logIndex,
        },
        create: {
          chainId,
          contractAddress: contractAddressLower,
          arbitratorCount: nextCount,
          arbitratorThreshold: currentState?.arbitratorThreshold ?? null,
          lastUpdatedTxHash: txHashLower,
          lastUpdatedBlock: eventLog.blockNumber,
          lastUpdatedLogIndex: eventLog.logIndex,
        },
      });
    }
    return;
  }

  if (eventLog.name === "RoleAdminChanged") {
    const role = asBytes32(eventLog.args.role).toLowerCase();
    const previousAdminRole = asBytes32(eventLog.args.previousAdminRole).toLowerCase();
    const newAdminRole = asBytes32(eventLog.args.newAdminRole).toLowerCase();
    await tx.roleGovernanceEvent.upsert({
      where: {
        chainId_txHash_logIndex: {
          chainId,
          txHash: txHashLower,
          logIndex: eventLog.logIndex,
        },
      },
      update: {
        contractAddress: contractAddressLower,
        eventType: "role_admin_changed",
        role,
        account: null,
        sender: null,
        previousAdminRole,
        newAdminRole,
        blockNumber: eventLog.blockNumber,
      },
      create: {
        chainId,
        contractAddress: contractAddressLower,
        eventType: "role_admin_changed",
        role,
        account: null,
        sender: null,
        previousAdminRole,
        newAdminRole,
        txHash: txHashLower,
        logIndex: eventLog.logIndex,
        blockNumber: eventLog.blockNumber,
      },
    });
    return;
  }

  const previousThreshold = asBigInt(eventLog.args.previousThreshold);
  const newThreshold = asBigInt(eventLog.args.newThreshold);
  const updatedBy = asAddress(eventLog.args.updatedBy).toLowerCase();

  await tx.arbitratorThresholdHistory.upsert({
    where: {
      chainId_txHash_logIndex: {
        chainId,
        txHash: txHashLower,
        logIndex: eventLog.logIndex,
      },
    },
    update: {
      contractAddress: contractAddressLower,
      previousThreshold,
      newThreshold,
      updatedBy,
      blockNumber: eventLog.blockNumber,
    },
    create: {
      chainId,
      contractAddress: contractAddressLower,
      previousThreshold,
      newThreshold,
      updatedBy,
      txHash: txHashLower,
      logIndex: eventLog.logIndex,
      blockNumber: eventLog.blockNumber,
    },
  });

  const currentState = await tx.arbitratorGovernanceState.findUnique({
    where: {
      chainId_contractAddress: {
        chainId,
        contractAddress: contractAddressLower,
      },
    },
    select: { arbitratorCount: true },
  });
  await tx.arbitratorGovernanceState.upsert({
    where: {
      chainId_contractAddress: {
        chainId,
        contractAddress: contractAddressLower,
      },
    },
    update: {
      arbitratorThreshold: newThreshold,
      lastUpdatedTxHash: txHashLower,
      lastUpdatedBlock: eventLog.blockNumber,
      lastUpdatedLogIndex: eventLog.logIndex,
    },
    create: {
      chainId,
      contractAddress: contractAddressLower,
      arbitratorCount: currentState?.arbitratorCount ?? 0,
      arbitratorThreshold: newThreshold,
      lastUpdatedTxHash: txHashLower,
      lastUpdatedBlock: eventLog.blockNumber,
      lastUpdatedLogIndex: eventLog.logIndex,
    },
  });
}

function reduceProjectionState(eventLog: SupportedEventLog): ProjectionState {
  if (eventLog.name === "Paused" || eventLog.name === "Unpaused") {
    return {
      pauseState: {
        paused: eventLog.name === "Paused",
        account: asAddress(eventLog.args.account).toLowerCase(),
        eventName: eventLog.name,
      },
    };
  }
  if (eventLog.name === "AllowedTokenUpdated") {
    const token = asAddress(eventLog.args.token).toLowerCase();
    const allowed = Boolean(eventLog.args.allowed);
    return { allowedTokens: { [token]: { allowed } } };
  }
  if (eventLog.name === "TokenReviewAttested") {
    const token = asAddress(eventLog.args.token).toLowerCase();
    return { tokenReviews: { [token]: { attested: true, admin: asAddress(eventLog.args.admin).toLowerCase() } } };
  }
  if (eventLog.name === "ArbitratorThresholdUpdated") {
    return {
      arbitratorThreshold: {
        previous: asBigInt(eventLog.args.previousThreshold).toString(),
        current: asBigInt(eventLog.args.newThreshold).toString(),
      },
    };
  }
  if (eventLog.name === "AlternativeRecipientSet" || eventLog.name === "AlternativeRecipientExecuted") {
    const key = `${asBigInt(eventLog.args.projectId)}:${asBigInt(eventLog.args.milestoneIndex)}:${Boolean(eventLog.args.isFreelancer) ? "freelancer" : "client"}`;
    if (eventLog.name === "AlternativeRecipientSet") {
      const executableAfter = asBigInt(eventLog.args.executableAfter).toString();
      const recipient = asAddress(eventLog.args.recipient).toLowerCase();
      const isPartyAuthorized = executableAfter === "0";
      return {
        alternativeRecipients: {
          [key]: {
            // Contract semantics: party-authorized recipients are set with `executableAfter == 0`
            // and should not be treated as delayed pending alternatives.
            pendingRecipient: isPartyAuthorized ? null : recipient,
            executableAfter: isPartyAuthorized ? null : executableAfter,
            executedRecipient: null,
            partyAuthorizedRecipient: isPartyAuthorized ? recipient : null,
          },
        },
      };
    }
    return {
      alternativeRecipients: {
        [key]: {
          executedRecipient: asAddress(eventLog.args.recipient).toLowerCase(),
        },
      },
    };
  }
  if (eventLog.name === "DisputeResolved") {
    // Contract clears alternative recipient legs on dispute resolution.
    const projectId = asBigInt(eventLog.args.projectId).toString();
    const milestoneIndex = asBigInt(eventLog.args.milestoneIndex).toString();
    const freelancerKey = `${projectId}:${milestoneIndex}:freelancer`;
    const clientKey = `${projectId}:${milestoneIndex}:client`;
    return {
      alternativeRecipients: {
        [freelancerKey]: {
          pendingRecipient: null,
          executableAfter: null,
          executedRecipient: null,
        },
        [clientKey]: {
          pendingRecipient: null,
          executableAfter: null,
          executedRecipient: null,
        },
      },
    };
  }
  if (
    eventLog.name === "EmergencyDisputeResolutionProposed" ||
    eventLog.name === "EmergencyDisputeResolutionCancelled" ||
    eventLog.name === "EmergencyDisputeResolved"
  ) {
    const key = `${asBigInt(eventLog.args.projectId)}:${asBigInt(eventLog.args.milestoneIndex)}`;
    // On EmergencyDisputeResolved, contract also clears alternative recipient legs.
    if (eventLog.name === "EmergencyDisputeResolved") {
      const freelancerKey = `${asBigInt(eventLog.args.projectId)}:${asBigInt(eventLog.args.milestoneIndex)}:freelancer`;
      const clientKey = `${asBigInt(eventLog.args.projectId)}:${asBigInt(eventLog.args.milestoneIndex)}:client`;
      return {
        emergencyResolutions: {
          [key]: {
            status: "resolved",
            readyAt: null,
          },
        },
        alternativeRecipients: {
          [freelancerKey]: {
            pendingRecipient: null,
            executableAfter: null,
            executedRecipient: null,
          },
          [clientKey]: {
            pendingRecipient: null,
            executableAfter: null,
            executedRecipient: null,
          },
        },
      };
    }

    return {
      emergencyResolutions: {
        [key]: {
          status:
            eventLog.name === "EmergencyDisputeResolutionProposed"
              ? "proposed"
              : eventLog.name === "EmergencyDisputeResolutionCancelled"
                ? "cancelled"
                : "resolved",
          readyAt:
            eventLog.name === "EmergencyDisputeResolutionProposed"
              ? asBigInt(eventLog.args.readyAt).toString()
              : null,
        },
      },
    };
  }
  return {};
}

async function resolveUserIdByAddress(
  tx: Prisma.TransactionClient,
  address: `0x${string}`,
): Promise<string> {
  const user = await tx.user.findUnique({
    where: { walletAddress: address.toLowerCase() },
    select: { id: true },
  });
  if (user) return user.id;
  const created = await tx.user.create({
    data: { walletAddress: address.toLowerCase() },
    select: { id: true },
  });
  return created.id;
}

function shouldApplyProjection(
  existingEventName: string | null,
  incomingEventName: string,
): boolean {
  return existingEventName !== incomingEventName;
}

function mergeProjectionState(
  previous: ProjectionState,
  patch: ProjectionState,
): ProjectionState {
  return deepMergeJsonObjects(previous, patch);
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
  const projectId = eventLog.args.projectId;
  const base = {
    eventType: eventLog.name,
    contractProjectId: typeof projectId === "bigint" ? projectId.toString() : null,
    blockTimestamp: blockTimestamp?.toISOString() ?? null,
    blockTimestampUnixSeconds: blockTimestamp
      ? Math.floor(blockTimestamp.getTime() / 1000)
      : null,
  } satisfies Prisma.JsonObject;

  if (eventLog.name === "ProjectCreated") {
    return {
      ...base,
      client: asAddress(eventLog.args.client).toLowerCase(),
      freelancer: asAddress(eventLog.args.freelancer).toLowerCase(),
      token: asAddress(eventLog.args.token).toLowerCase(),
      totalAmount: asBigInt(eventLog.args.totalAmount).toString(),
      metadataURI: asString(eventLog.args.metadataURI),
      milestoneCount: asBigInt(eventLog.args.milestoneCount).toString(),
    } satisfies Prisma.JsonObject;
  }
  if (eventLog.name === "ProjectFunded") {
    return {
      ...base,
      client: asAddress(eventLog.args.client).toLowerCase(),
      token: asAddress(eventLog.args.token).toLowerCase(),
      amount: asBigInt(eventLog.args.amount).toString(),
      fundedAmountAfter: asBigInt(eventLog.args.fundedAmountAfter).toString(),
    } satisfies Prisma.JsonObject;
  }
  return { ...base, args: jsonSafeArgs(eventLog.args) } satisfies Prisma.JsonObject;
}

function inferFromAddress(eventLog: SupportedEventLog): string {
  const candidateKeys = [
    "client",
    "freelancer",
    "raisedBy",
    "submittedBy",
    "resolver",
    "admin",
    "executedBy",
    "updatedBy",
    "advancedBy",
    "arbitrator",
    "sender",
    "account",
  ] as const;
  for (const key of candidateKeys) {
    const raw = eventLog.args[key];
    if (typeof raw === "string" && /^0x[a-fA-F0-9]{40}$/.test(raw)) {
      return getAddress(raw).toLowerCase();
    }
  }
  return ZERO_ADDRESS;
}

function parseStoredChainEventLog(row: {
  eventName: string;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  payload: Prisma.JsonValue;
}): SupportedEventLog | null {
  if (!supportedEventNames.has(row.eventName)) {
    return null;
  }
  const payload = isJsonObject(row.payload) ? row.payload : null;
  const maybeArgs = payload && isJsonObject(payload.args) ? payload.args : {};
  return {
    name: row.eventName as SupportedEventName,
    blockNumber: row.blockNumber,
    blockHash: null,
    txHash: row.txHash as `0x${string}`,
    logIndex: row.logIndex,
    args: maybeArgs as Record<string, unknown>,
  };
}

function readBlockTimestampFromPayload(payload: Prisma.JsonValue): Date | null {
  if (!isJsonObject(payload)) return null;
  const value = payload.blockTimestamp;
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function replayProjectionFromStoredLog(
  tx: Prisma.TransactionClient,
  input: {
    chainId: number;
    contractAddress: `0x${string}`;
    eventLog: SupportedEventLog;
    blockDate: Date | null;
  },
): Promise<void> {
  const { eventLog, chainId, contractAddress, blockDate } = input;
  if (eventLog.name === "Paused" || eventLog.name === "Unpaused") {
    await syncPauseStateProjection(tx, chainId, contractAddress, eventLog, blockDate);
    return;
  }
  if (
    eventLog.name === "EmergencyDisputeResolutionProposed" ||
    eventLog.name === "EmergencyDisputeResolutionCancelled" ||
    eventLog.name === "EmergencyDisputeResolutionNonceAdvanced" ||
    eventLog.name === "EmergencyDisputeResolved"
  ) {
    await syncEmergencyResolutionProposal(tx, chainId, contractAddress, eventLog);
  }
  if (
    eventLog.name === "AlternativeRecipientSet" ||
    eventLog.name === "AlternativeRecipientExecuted" ||
    eventLog.name === "DisputeResolved" ||
    eventLog.name === "EmergencyDisputeResolved" ||
    eventLog.name === "ProjectCancelled" ||
    eventLog.name === "ProjectEmergencyCancelled"
  ) {
    await syncAlternativeRecipientState(tx, chainId, contractAddress, eventLog);
  }
  if (eventLog.name === "TokenReviewAttested" || eventLog.name === "AllowedTokenUpdated") {
    await syncTokenGovernanceState(tx, chainId, contractAddress, eventLog);
    return;
  }
  if (
    eventLog.name === "RoleGranted" ||
    eventLog.name === "RoleRevoked" ||
    eventLog.name === "RoleAdminChanged" ||
    eventLog.name === "ArbitratorThresholdUpdated"
  ) {
    await syncRoleAndArbitratorGovernanceState(tx, chainId, contractAddress, eventLog);
  }
}

function asBigInt(value: unknown): bigint {
  return typeof value === "bigint" ? value : 0n;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asAddress(value: unknown): `0x${string}` {
  if (typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)) {
    return getAddress(value) as `0x${string}`;
  }
  return ZERO_ADDRESS;
}

function asBytes32(value: unknown): `0x${string}` {
  if (typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value)) {
    return value.toLowerCase() as `0x${string}`;
  }
  return `0x${"0".repeat(64)}` as `0x${string}`;
}

function jsonSafeArgs(args: Record<string, unknown>): Prisma.JsonObject {
  const out: Record<string, Prisma.JsonValue> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = toJsonValue(value);
  }
  return out;
}

function toJsonValue(value: unknown): Prisma.JsonValue {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (typeof value === "object") {
    const out: Record<string, Prisma.JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonValue(v);
    }
    return out;
  }
  return String(value);
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

function isJsonObject(value: unknown): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMergeJsonObjects(
  base: Prisma.JsonObject,
  patch: Prisma.JsonObject,
): Prisma.JsonObject {
  const out = { ...base } as Prisma.JsonObject;
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) {
      continue;
    }
    const baseValue = out[key];
    if (isJsonObject(baseValue) && isJsonObject(patchValue)) {
      out[key] = deepMergeJsonObjects(baseValue, patchValue);
      continue;
    }
    out[key] = patchValue as Prisma.JsonValue;
  }
  return out;
}

function transactionLogUniqueKey(input: {
  chainId: number;
  txHash: string;
  logIndex: number;
}): string {
  return `${input.chainId}:${input.txHash.toLowerCase()}:${input.logIndex}`;
}

export const __eventSyncInternals = {
  shouldApplyProjection,
  mergeProjectionState,
  reduceProjectionState,
  transactionLogUniqueKey,
  computeRewindFromBlock,
  isBlockHashMismatch,
};

export async function getLatestContractPauseSnapshot(input: {
  chainId: number;
  contractAddress: `0x${string}`;
}): Promise<ContractPauseSnapshot> {
  const rows = await prisma.$queryRaw<
    Array<{
      chainId: number;
      contractAddress: string;
      paused: boolean;
      eventName: string;
      updatedBy: string | null;
      lastChangedBlock: bigint;
      lastChangedTxHash: string;
      lastChangedLogIndex: number;
      lastChangedAt: Date | null;
    }>
  >(
    Prisma.sql`
      SELECT
        "chainId",
        "contractAddress",
        "paused",
        "eventName",
        "updatedBy",
        "lastChangedBlock",
        "lastChangedTxHash",
        "lastChangedLogIndex",
        "lastChangedAt"
      FROM "contract_pause_states"
      WHERE "chainId" = ${input.chainId}
        AND "contractAddress" = ${input.contractAddress.toLowerCase()}
      LIMIT 1
    `,
  );

  const row = rows[0];
  if (!row) {
    return null;
  }
  const eventName = row.eventName === "Paused" ? "Paused" : "Unpaused";
  return {
    chainId: row.chainId,
    contractAddress: row.contractAddress,
    paused: row.paused,
    eventName,
    updatedBy: row.updatedBy,
    lastChangedBlock: row.lastChangedBlock.toString(),
    lastChangedTxHash: row.lastChangedTxHash,
    lastChangedLogIndex: row.lastChangedLogIndex,
    lastChangedAt: row.lastChangedAt ? row.lastChangedAt.toISOString() : null,
  };
}
