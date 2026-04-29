import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type AbiEvent,
  type Hex,
} from "viem";
import { TransactionLogSourceType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";

const { createPublicClientMock, getEventSyncEnvMock } = vi.hoisted(() => ({
  createPublicClientMock: vi.fn(),
  getEventSyncEnvMock: vi.fn(),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
  };
});

vi.mock("@/server/event-sync/env", () => ({
  getEventSyncEnv: getEventSyncEnvMock,
}));

import { syncEscrowEventsOnce } from "@/server/services/event-sync-service";

type Address = `0x${string}`;

describe("event-sync reorg DB rewind+replay integration", () => {
  const chainId = 31337;
  const contractAddress = "0x1111111111111111111111111111111111111111" as Address;
  const scope = `ESCROW_REGISTRY:${contractAddress}`;
  const projectOnChainId = 42n;
  const eventStartBlock = 190;
  const reorgDepth = 2;

  const clientWallet = "0x2222222222222222222222222222222222222222" as Address;
  const freelancerWallet = "0x3333333333333333333333333333333333333333" as Address;
  const adminWallet = "0x4444444444444444444444444444444444444444" as Address;
  const altRecipient = "0x5555555555555555555555555555555555555555" as Address;
  const token = "0x6666666666666666666666666666666666666666" as Address;

  const oldHashes = {
    block200: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
    tx198: ("0x" + "98".repeat(32)) as Hex,
    tx199: ("0x" + "99".repeat(32)) as Hex,
    tx200: ("0x" + "aa".repeat(32)) as Hex,
  } as const;
  const replacementHashes = {
    block199: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex,
    block200: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex,
    block201: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as Hex,
    tx199: ("0x" + "b1".repeat(32)) as Hex,
    tx200: ("0x" + "c2".repeat(32)) as Hex,
    tx201: ("0x" + "d3".repeat(32)) as Hex,
  } as const;

  let projectId = "";

  beforeAll(async () => {
    const dbOk = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    if (!dbOk?.length) {
      throw new Error("database unavailable for reorg integration test");
    }
    await prisma.$transaction([
      prisma.transactionLog.deleteMany({ where: { chainId, toAddress: contractAddress } }),
      prisma.contractPauseState.deleteMany({ where: { chainId, contractAddress } }),
      prisma.emergencyResolutionProposal.deleteMany({ where: { chainId, contractAddress } }),
      prisma.alternativeRecipientState.deleteMany({ where: { chainId, contractAddress } }),
      prisma.eventSyncCheckpoint.deleteMany({ where: { chainId, scope } }),
      prisma.project.deleteMany({
        where: { chainId, escrowContractAddress: contractAddress, onChainProjectId: projectOnChainId.toString() },
      }),
    ]);

    getEventSyncEnvMock.mockReturnValue({
      EVENT_SYNC_RPC_URL: "http://mock-rpc.invalid",
      EVENT_SYNC_CHAIN_ID: chainId,
      EVENT_SYNC_CONTRACT_ADDRESS: contractAddress,
      EVENT_SYNC_SCOPE: scope,
      EVENT_SYNC_START_BLOCK: eventStartBlock,
      EVENT_SYNC_BATCH_SIZE: 100,
      EVENT_SYNC_CONFIRMATIONS: 0,
      EVENT_SYNC_RPC_RETRIES: 0,
      EVENT_SYNC_RPC_RETRY_DELAY_MS: 1,
      EVENT_SYNC_REWIND_DEPTH: reorgDepth,
      EVENT_SYNC_TRIGGER_TOKEN: undefined,
    });

    const replacementLogs = [
      buildRawLog({
        eventName: "AlternativeRecipientSet",
        args: {
          projectId: projectOnChainId,
          milestoneIndex: 0n,
          isFreelancer: true,
          recipient: altRecipient,
          executableAfter: 1_800_000_000n,
          updatedBy: adminWallet,
        },
        blockNumber: 199n,
        blockHash: replacementHashes.block199,
        txHash: replacementHashes.tx199,
        logIndex: 0,
      }),
      buildRawLog({
        eventName: "EmergencyDisputeResolutionProposed",
        args: {
          projectId: projectOnChainId,
          milestoneIndex: 0n,
          admin: adminWallet,
          actionHash: "0x" + "11".repeat(32),
          resolutionKind: 1n,
          freelancerAmount: 100n,
          clientAmount: 50n,
          readyAt: 1_800_000_001n,
        },
        blockNumber: 200n,
        blockHash: replacementHashes.block200,
        txHash: replacementHashes.tx200,
        logIndex: 0,
      }),
      buildRawLog({
        eventName: "Paused",
        args: { account: adminWallet },
        blockNumber: 201n,
        blockHash: replacementHashes.block201,
        txHash: replacementHashes.tx201,
        logIndex: 0,
      }),
    ];

    createPublicClientMock.mockReturnValue({
      getBlockNumber: vi.fn(async () => 201n),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
        replacementLogs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock),
      ),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
        if (blockNumber === 200n) {
          return { hash: replacementHashes.block200, timestamp: 1_800_000_000n };
        }
        if (blockNumber === 199n) {
          return { hash: replacementHashes.block199, timestamp: 1_800_000_000n };
        }
        if (blockNumber === 201n) {
          return { hash: replacementHashes.block201, timestamp: 1_800_000_002n };
        }
        return {
          hash: "0x" + "ef".repeat(32),
          timestamp: 1_800_000_000n,
        };
      }),
    });

    const [clientUser, freelancerUser] = await Promise.all([
      prisma.user.upsert({
        where: { walletAddress: clientWallet },
        update: {},
        create: { walletAddress: clientWallet },
      }),
      prisma.user.upsert({
        where: { walletAddress: freelancerWallet },
        update: {},
        create: { walletAddress: freelancerWallet },
      }),
    ]);

    const project = await prisma.project.create({
      data: {
        clientUserId: clientUser.id,
        freelancerUserId: freelancerUser.id,
        title: "reorg-integration-project",
        status: "ACTIVE",
        visibility: "PRIVATE",
        chainId,
        escrowContractAddress: contractAddress,
        onChainProjectId: projectOnChainId.toString(),
        paymentTokenAddress: token,
        totalValueWei: "1000",
      },
      select: { id: true },
    });
    projectId = project.id;

    await prisma.eventSyncCheckpoint.create({
      data: {
        chainId,
        scope,
        lastProcessedBlock: 200n,
        lastProcessedBlockHash: oldHashes.block200,
        lastProcessedLogIndex: 0,
        cursorState: {},
      },
    });

    await prisma.transactionLog.createMany({
      data: [
        {
          chainId,
          blockNumber: 198n,
          txHash: oldHashes.tx198,
          logIndex: 0,
          eventName: "Paused",
          sourceType: TransactionLogSourceType.chain_event,
          fromAddress: adminWallet,
          toAddress: contractAddress,
          payload: { eventType: "Paused", args: { account: adminWallet } },
        },
        {
          chainId,
          blockNumber: 199n,
          txHash: oldHashes.tx199,
          logIndex: 0,
          eventName: "AlternativeRecipientSet",
          sourceType: TransactionLogSourceType.chain_event,
          projectId,
          fromAddress: adminWallet,
          toAddress: contractAddress,
          payload: {
            eventType: "AlternativeRecipientSet",
            args: {
              projectId: projectOnChainId.toString(),
              milestoneIndex: "0",
              isFreelancer: true,
              recipient: "0x7777777777777777777777777777777777777777",
              executableAfter: "1700000000",
              updatedBy: adminWallet,
            },
          },
        },
        {
          chainId,
          blockNumber: 200n,
          txHash: oldHashes.tx200,
          logIndex: 0,
          eventName: "EmergencyDisputeResolutionProposed",
          sourceType: TransactionLogSourceType.chain_event,
          projectId,
          fromAddress: adminWallet,
          toAddress: contractAddress,
          payload: {
            eventType: "EmergencyDisputeResolutionProposed",
            args: {
              projectId: projectOnChainId.toString(),
              milestoneIndex: "0",
              admin: adminWallet,
              actionHash: "0x" + "22".repeat(32),
              resolutionKind: "1",
              freelancerAmount: "10",
              clientAmount: "5",
              readyAt: "1700000001",
            },
          },
        },
      ],
    });

    await prisma.contractPauseState.upsert({
      where: { chainId_contractAddress: { chainId, contractAddress } },
      update: {
        paused: false,
        eventName: "Unpaused",
        lastChangedBlock: 200n,
        lastChangedTxHash: oldHashes.tx200,
        lastChangedLogIndex: 0,
      },
      create: {
        chainId,
        contractAddress,
        paused: false,
        eventName: "Unpaused",
        updatedBy: adminWallet,
        lastChangedBlock: 200n,
        lastChangedTxHash: oldHashes.tx200,
        lastChangedLogIndex: 0,
      },
    });
    await prisma.emergencyResolutionProposal.create({
      data: {
        chainId,
        contractAddress,
        projectDbId: projectId,
        projectId: projectOnChainId.toString(),
        milestoneIndex: 0,
        actionHash: "0x" + "22".repeat(32),
        kind: 1,
        freelancerAmount: "10",
        clientAmount: "5",
        readyAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "proposed",
        txHash: oldHashes.tx200,
        logIndex: 0,
      },
    });
    await prisma.alternativeRecipientState.create({
      data: {
        chainId,
        contractAddress,
        projectDbId: projectId,
        projectId: projectOnChainId.toString(),
        milestoneIndex: 0,
        isFreelancer: true,
        pendingRecipient: "0x7777777777777777777777777777777777777777",
        executableAfter: 1_700_000_000n,
        activeRecipient: null,
        partyAuthorizedRecipient: null,
        status: "pending",
        updatedAtBlock: 199n,
        updatedAtTxHash: oldHashes.tx199,
        updatedAtLogIndex: 0,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.$transaction([
      prisma.transactionLog.deleteMany({ where: { chainId, toAddress: contractAddress } }),
      prisma.contractPauseState.deleteMany({ where: { chainId, contractAddress } }),
      prisma.emergencyResolutionProposal.deleteMany({ where: { chainId, contractAddress } }),
      prisma.alternativeRecipientState.deleteMany({ where: { chainId, contractAddress } }),
      prisma.eventSyncCheckpoint.deleteMany({ where: { chainId, scope } }),
      prisma.project.deleteMany({
        where: { chainId, escrowContractAddress: contractAddress, onChainProjectId: projectOnChainId.toString() },
      }),
      prisma.user.deleteMany({ where: { walletAddress: { in: [clientWallet, freelancerWallet] } } }),
    ]);
  }, 30_000);

  it("rewinds on checkpoint hash mismatch and rebuilds DB projections from replacement chain events", async () => {
    const result = await syncEscrowEventsOnce();

    expect(result.processedEvents).toBe(3);
    expect(result.fromBlock).toBe("190");
    expect(result.toBlock).toBe("201");
    expect(result.checkpointBlock).toBe("201");

    const txLogs = await prisma.transactionLog.findMany({
      where: { chainId, toAddress: contractAddress, sourceType: TransactionLogSourceType.chain_event },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      select: { txHash: true, blockNumber: true, eventName: true, logIndex: true },
    });
    expect(txLogs).toHaveLength(3);
    expect(txLogs.map((row) => row.txHash)).toEqual([
      replacementHashes.tx199.toLowerCase(),
      replacementHashes.tx200.toLowerCase(),
      replacementHashes.tx201.toLowerCase(),
    ]);
    expect(txLogs.every((row) => row.logIndex >= 0)).toBe(true);
    expect(txLogs.find((row) => row.txHash === oldHashes.tx199.toLowerCase())).toBeUndefined();
    expect(txLogs.find((row) => row.txHash === oldHashes.tx200.toLowerCase())).toBeUndefined();

    const [pauseState, emergency, altRecipientState, checkpoint, project] = await Promise.all([
      prisma.contractPauseState.findUnique({
        where: { chainId_contractAddress: { chainId, contractAddress } },
      }),
      prisma.emergencyResolutionProposal.findMany({
        where: { chainId, contractAddress, projectId: projectOnChainId.toString(), milestoneIndex: 0 },
      }),
      prisma.alternativeRecipientState.findUnique({
        where: {
          chainId_contractAddress_projectId_milestoneIndex_isFreelancer: {
            chainId,
            contractAddress,
            projectId: projectOnChainId.toString(),
            milestoneIndex: 0,
            isFreelancer: true,
          },
        },
      }),
      prisma.eventSyncCheckpoint.findUnique({
        where: { chainId_scope: { chainId, scope } },
      }),
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
    ]);

    expect(project).not.toBeNull();
    expect(pauseState?.paused).toBe(true);
    expect(pauseState?.eventName).toBe("Paused");
    expect(pauseState?.lastChangedTxHash).toBe(replacementHashes.tx201.toLowerCase());

    expect(emergency).toHaveLength(1);
    expect(emergency[0]?.status).toBe("proposed");
    expect(emergency[0]?.txHash).toBe(replacementHashes.tx200.toLowerCase());
    expect(emergency[0]?.actionHash).toBe("0x" + "11".repeat(32));

    expect(altRecipientState).not.toBeNull();
    expect(altRecipientState?.status).toBe("pending");
    expect(altRecipientState?.pendingRecipient).toBe(altRecipient.toLowerCase());
    expect(altRecipientState?.updatedAtTxHash).toBe(replacementHashes.tx199.toLowerCase());

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.lastProcessedBlock).toBe(201n);
    expect(checkpoint?.lastProcessedBlockHash).toBe(replacementHashes.block201);
    expect(checkpoint?.lastProcessedLogIndex).toBe(0);
  }, 60_000);
});

function buildRawLog(input: {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
}): {
  data: Hex;
  topics: [] | [Hex, ...Hex[]];
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
} {
  const event = escrowRegistryAbi.find(
    (item) => item.type === "event" && (item as { name?: string }).name === input.eventName,
  ) as AbiEvent | undefined;
  if (!event) {
    throw new Error(`Missing ABI event ${input.eventName}`);
  }
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: input.args,
  });
  const nonIndexedInputs = event.inputs.filter((entry) => !entry.indexed);
  const values = nonIndexedInputs.map((entry, idx) =>
    input.args[entry.name && entry.name.length > 0 ? entry.name : `arg${idx}`],
  );
  const data = nonIndexedInputs.length
    ? (encodeAbiParameters(nonIndexedInputs, values) as Hex)
    : ("0x" as Hex);
  return {
    data,
    topics: topics as [] | [Hex, ...Hex[]],
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    transactionHash: input.txHash,
    logIndex: input.logIndex,
  };
}
