import "server-only";

import {
  DisputeStatus,
  MilestoneStatus,
  ProjectStatus,
  ProjectVisibility,
  Prisma,
  SubmissionStatus,
} from "@prisma/client";
import { createPublicClient, decodeEventLog, getAddress, http, type Log } from "viem";

import { prisma } from "@/lib/prisma";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import { createLogger } from "@/server/logging/logger";
import { getEventSyncEnv } from "@/server/event-sync/env";
import { milestoneFundingSyncUpdates } from "@/server/services/funding-service";

const DEPRECATED_ESCROW_REGISTRY_ADDRESS =
  "0x268993a0e0342972a52c58aa2dd1a9953fd57acf";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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
    select: { lastProcessedBlock: true, lastProcessedLogIndex: true, cursorState: true },
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
    let projectionState: ProjectionState = isJsonObject(checkpoint?.cursorState)
      ? checkpoint.cursorState
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
    return {
      projectId: await syncDisputeResolved(tx, chainId, contractAddress, eventLog, blockDate),
      statePatch: {},
    };
  }
  if (eventLog.name === "ProjectCancelled" || eventLog.name === "ProjectEmergencyCancelled") {
    return {
      projectId: await syncProjectCancelled(tx, chainId, contractAddress, eventLog, blockDate),
      statePatch: {},
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

function reduceProjectionState(eventLog: SupportedEventLog): ProjectionState {
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

export const __eventSyncInternals = {
  shouldApplyProjection,
  mergeProjectionState,
  reduceProjectionState,
};
