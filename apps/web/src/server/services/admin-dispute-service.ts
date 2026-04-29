import {
  DisputeStatus,
  MilestoneStatus,
  Prisma,
  ProjectStatus,
  SubmissionStatus,
  TransactionLogSourceType,
} from "@prisma/client";

import type {
  AdminDisputeDetail,
  ListAdminDisputesResponse,
  ResolveDisputeResponse,
  UserPublicRef,
} from "@escrowflow/types";

import type {
  ListAdminDisputesQueryInput,
  ResolveDisputeBody,
} from "@/server/validation/schemas/admin-disputes";
import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { AppError } from "@/server/errors/app-error";
import { notifyDisputeResolved } from "@/server/services/notification-events";

const OPEN_DISPUTE_STATUSES: DisputeStatus[] = [
  DisputeStatus.OPEN,
  DisputeStatus.AWAITING_RESPONSE,
  DisputeStatus.UNDER_ADMIN_REVIEW,
];
const RESOLVED_DISPUTE_STATUSES: DisputeStatus[] = [
  DisputeStatus.RESOLVED_CLIENT_FAVOR,
  DisputeStatus.RESOLVED_FREELANCER_FAVOR,
  DisputeStatus.RESOLVED_SPLIT,
  DisputeStatus.DISMISSED,
  DisputeStatus.WITHDRAWN,
];

export async function listAdminDisputes(
  query: ListAdminDisputesQueryInput,
): Promise<ListAdminDisputesResponse> {
  const statusFilter = query.status ?? "open";
  const limit = query.limit ?? 20;
  const statuses =
    statusFilter === "open"
      ? OPEN_DISPUTE_STATUSES
      : statusFilter === "resolved"
        ? RESOLVED_DISPUTE_STATUSES
        : undefined;

  const rows = await prisma.dispute.findMany({
    where: statuses ? { status: { in: statuses } } : undefined,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      openedBy: { include: { profile: true } },
      resolvedBy: { include: { profile: true } },
      relatedSubmission: {
        select: {
          id: true,
          status: true,
          summary: true,
          submittedAt: true,
        },
      },
      milestone: {
        include: {
          submissions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true },
          },
          project: {
            include: {
              client: { include: { profile: true } },
              freelancer: { include: { profile: true } },
            },
          },
        },
      },
    },
  });

  const items = await Promise.all(rows.map((row) => mapAdminDisputeDetail(row)));
  return { items };
}

export async function resolveDisputeAsAdmin(input: {
  disputeId: string;
  adminUserId: string;
  payload: ResolveDisputeBody;
}): Promise<ResolveDisputeResponse> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: input.disputeId },
    include: {
      milestone: {
        include: {
          project: true,
        },
      },
      relatedSubmission: true,
    },
  });
  if (!dispute) {
    throw AppError.notFound("DISPUTE_NOT_FOUND", "Dispute not found");
  }
  if (!OPEN_DISPUTE_STATUSES.includes(dispute.status)) {
    throw new AppError("DISPUTE_ALREADY_RESOLVED", "Dispute is already resolved", 409);
  }

  validateResolutionAmounts(input.payload, dispute.milestone.amountWei);
  validateOnchainResolutionPayload(input.payload, {
    chainId: dispute.milestone.project.chainId,
    escrowContractAddress: dispute.milestone.project.escrowContractAddress,
    onChainProjectId: dispute.milestone.project.onChainProjectId,
    milestoneIndex: dispute.milestone.sortOrder,
  });

  const now = new Date();
  await prisma.$transaction(
    async (tx) => {
      await tx.dispute.update({
        where: { id: dispute.id },
        data: {
          status: mapKindToDisputeStatus(input.payload.kind),
          internalNotes: input.payload.resolutionNote ?? null,
          resolvedByUserId: input.adminUserId,
          resolvedAt: now,
          resolutionTxHash: input.payload.resolutionTxHash ?? null,
        },
      });

      await tx.milestone.update({
        where: { id: dispute.milestoneId },
        data: {
          status:
            input.payload.kind === "REFUND_TO_CLIENT"
              ? MilestoneStatus.VOIDED
              : MilestoneStatus.RELEASED,
          releasedAt: input.payload.kind === "REFUND_TO_CLIENT" ? null : now,
        },
      });

      if (dispute.relatedSubmissionId) {
        await tx.submission.update({
          where: { id: dispute.relatedSubmissionId },
          data: {
            status:
              input.payload.kind === "REFUND_TO_CLIENT"
                ? SubmissionStatus.REJECTED
                : SubmissionStatus.ACCEPTED,
            decidedAt: now,
          },
        });
      }

      const chainId = input.payload.chainId ?? dispute.milestone.project.chainId ?? 0;
      const txHash =
        input.payload.resolutionTxHash?.toLowerCase() ??
        `offchain-dispute-resolved-${dispute.id}`;
      const toAddress =
        input.payload.escrowContractAddress?.toLowerCase() ??
        dispute.milestone.project.escrowContractAddress?.toLowerCase() ??
        null;

      await tx.transactionLog.upsert({
        where: {
          chainId_txHash_logIndex: {
            chainId,
            txHash,
            logIndex: -1,
          },
        },
        update: {
          sourceType: input.payload.resolutionTxHash
            ? TransactionLogSourceType.synthetic_client_reconcile
            : TransactionLogSourceType.backend_metadata,
          payload: {
            disputeId: dispute.id,
            milestoneId: dispute.milestoneId,
            kind: input.payload.kind,
            freelancerAmount: input.payload.freelancerAmountWei,
            clientAmount: input.payload.clientAmountWei,
            note: input.payload.resolutionNote ?? null,
            source: input.payload.resolutionTxHash ? "onchain_admin_resolution" : "offchain_admin_resolution",
          },
        },
        create: {
          chainId,
          blockNumber: 0n,
          txHash,
          logIndex: -1,
          eventName: "DisputeResolved",
          sourceType: input.payload.resolutionTxHash
            ? TransactionLogSourceType.synthetic_client_reconcile
            : TransactionLogSourceType.backend_metadata,
          projectId: dispute.milestone.projectId,
          milestoneId: dispute.milestoneId,
          initiatedByUserId: input.adminUserId,
          fromAddress: null,
          toAddress,
          payload: {
            disputeId: dispute.id,
            milestoneId: dispute.milestoneId,
            kind: input.payload.kind,
            freelancerAmount: input.payload.freelancerAmountWei,
            clientAmount: input.payload.clientAmountWei,
            note: input.payload.resolutionNote ?? null,
            onChainProjectId:
              input.payload.onChainProjectId ?? dispute.milestone.project.onChainProjectId,
            milestoneIndex:
              input.payload.milestoneIndex ?? dispute.milestone.sortOrder,
            source: input.payload.resolutionTxHash ? "onchain_admin_resolution" : "offchain_admin_resolution",
          },
        },
      });

      const [remainingOpenDisputes, totalMilestones, terminalMilestones] = await Promise.all([
        tx.dispute.count({
          where: {
            milestone: { projectId: dispute.milestone.projectId },
            status: { in: OPEN_DISPUTE_STATUSES },
          },
        }),
        tx.milestone.count({
          where: { projectId: dispute.milestone.projectId },
        }),
        tx.milestone.count({
          where: {
            projectId: dispute.milestone.projectId,
            status: { in: [MilestoneStatus.RELEASED, MilestoneStatus.VOIDED] },
          },
        }),
      ]);

      const nextStatus =
        remainingOpenDisputes > 0
          ? ProjectStatus.DISPUTED
          : totalMilestones > 0 && terminalMilestones === totalMilestones
            ? ProjectStatus.COMPLETED
            : ProjectStatus.ACTIVE;

      await tx.project.update({
        where: { id: dispute.milestone.projectId },
        data: {
          status: nextStatus,
          completedAt: nextStatus === ProjectStatus.COMPLETED ? now : null,
        },
      });
    },
    prismaInteractiveTransactionOptions,
  );

  const refreshed = await prisma.dispute.findUnique({
    where: { id: dispute.id },
    include: {
      openedBy: { include: { profile: true } },
      resolvedBy: { include: { profile: true } },
      relatedSubmission: {
        select: {
          id: true,
          status: true,
          summary: true,
          submittedAt: true,
        },
      },
      milestone: {
        include: {
          submissions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true },
          },
          project: {
            include: {
              client: { include: { profile: true } },
              freelancer: { include: { profile: true } },
            },
          },
        },
      },
    },
  });
  if (!refreshed) {
    throw AppError.notFound("DISPUTE_NOT_FOUND", "Dispute not found after resolution");
  }

  void notifyDisputeResolved({
    projectId: refreshed.milestone.project.id,
    milestoneId: refreshed.milestone.id,
    milestoneTitle: refreshed.milestone.title,
    clientUserId: refreshed.milestone.project.client.id,
    freelancerUserId: refreshed.milestone.project.freelancer?.id ?? null,
    disputeId: refreshed.id,
    outcome: mapKindToNotificationOutcome(input.payload.kind),
  }).catch(() => undefined);

  return { dispute: await mapAdminDisputeDetail(refreshed) };
}

function validateResolutionAmounts(
  payload: ResolveDisputeBody,
  milestoneAmountWei: string,
): void {
  const milestoneAmount = BigInt(milestoneAmountWei);
  const freelancerAmount = BigInt(payload.freelancerAmountWei);
  const clientAmount = BigInt(payload.clientAmountWei);

  if (payload.kind === "PAYOUT_TO_FREELANCER") {
    if (freelancerAmount !== milestoneAmount || clientAmount !== 0n) {
      throw new AppError(
        "INVALID_RESOLUTION_AMOUNTS",
        "Payout resolution must send full milestone amount to freelancer and 0 to client",
        400,
      );
    }
    return;
  }
  if (payload.kind === "REFUND_TO_CLIENT") {
    if (clientAmount !== milestoneAmount || freelancerAmount !== 0n) {
      throw new AppError(
        "INVALID_RESOLUTION_AMOUNTS",
        "Refund resolution must send full milestone amount to client and 0 to freelancer",
        400,
      );
    }
    return;
  }

  if (freelancerAmount <= 0n || clientAmount <= 0n) {
    throw new AppError(
      "INVALID_SPLIT_AMOUNTS",
      "Split resolution requires both freelancer and client amounts to be greater than zero",
      400,
    );
  }
  if (freelancerAmount + clientAmount !== milestoneAmount) {
    throw new AppError(
      "INVALID_SPLIT_AMOUNTS",
      "Split resolution amounts must add up exactly to milestone amount",
      400,
    );
  }
}

function validateOnchainResolutionPayload(
  payload: ResolveDisputeBody,
  project: {
    chainId: number | null;
    escrowContractAddress: string | null;
    onChainProjectId: string | null;
    milestoneIndex: number;
  },
): void {
  const hasAnyOnchainField =
    payload.chainId !== undefined ||
    payload.escrowContractAddress !== undefined ||
    payload.onChainProjectId !== undefined ||
    payload.milestoneIndex !== undefined ||
    payload.resolutionTxHash !== undefined;
  if (!hasAnyOnchainField) {
    return;
  }

  if (!payload.resolutionTxHash) {
    throw new AppError(
      "RESOLUTION_TX_HASH_REQUIRED",
      "resolutionTxHash is required when using on-chain dispute resolution flow",
      400,
    );
  }
  if (payload.chainId !== undefined && project.chainId !== null && payload.chainId !== project.chainId) {
    throw new AppError("CHAIN_ID_MISMATCH", "Resolution chain does not match project chain", 400);
  }
  if (
    payload.escrowContractAddress &&
    project.escrowContractAddress &&
    payload.escrowContractAddress.toLowerCase() !== project.escrowContractAddress.toLowerCase()
  ) {
    throw new AppError(
      "ESCROW_CONTRACT_MISMATCH",
      "Resolution escrow contract does not match project escrow contract",
      400,
    );
  }
  if (
    payload.onChainProjectId &&
    project.onChainProjectId &&
    payload.onChainProjectId !== project.onChainProjectId
  ) {
    throw new AppError(
      "ONCHAIN_PROJECT_ID_MISMATCH",
      "Resolution on-chain project id does not match project data",
      400,
    );
  }
  if (payload.milestoneIndex !== undefined && payload.milestoneIndex !== project.milestoneIndex) {
    throw new AppError(
      "MILESTONE_INDEX_MISMATCH",
      "Resolution milestone index does not match milestone sort order",
      400,
    );
  }
}

function mapKindToDisputeStatus(kind: ResolveDisputeBody["kind"]): DisputeStatus {
  if (kind === "PAYOUT_TO_FREELANCER") {
    return DisputeStatus.RESOLVED_FREELANCER_FAVOR;
  }
  if (kind === "REFUND_TO_CLIENT") {
    return DisputeStatus.RESOLVED_CLIENT_FAVOR;
  }
  return DisputeStatus.RESOLVED_SPLIT;
}

function mapKindToNotificationOutcome(
  kind: ResolveDisputeBody["kind"],
): "RESOLVED_CLIENT_FAVOR" | "RESOLVED_FREELANCER_FAVOR" | "RESOLVED_SPLIT" {
  if (kind === "PAYOUT_TO_FREELANCER") {
    return "RESOLVED_FREELANCER_FAVOR";
  }
  if (kind === "REFUND_TO_CLIENT") {
    return "RESOLVED_CLIENT_FAVOR";
  }
  return "RESOLVED_SPLIT";
}

async function mapAdminDisputeDetail(dispute: {
  id: string;
  milestoneId: string;
  status: DisputeStatus;
  title: string | null;
  description: string;
  evidenceIpfsUri: string;
  relatedSubmissionId: string | null;
  resolutionTxHash: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  internalNotes: string | null;
  openedBy: {
    id: string;
    walletAddress: string;
    profile: { displayName: string; avatarUrl: string | null } | null;
  };
  resolvedBy: {
    id: string;
    walletAddress: string;
    profile: { displayName: string; avatarUrl: string | null } | null;
  } | null;
  relatedSubmission: {
    id: string;
    status: SubmissionStatus;
    summary: string | null;
    submittedAt: Date | null;
  } | null;
  milestone: {
    id: string;
    sortOrder: number;
    title: string;
    status: MilestoneStatus;
    amountWei: string;
    dueAt: Date | null;
    submissions: Array<{ id: string }>;
    project: {
      id: string;
      title: string;
      status: ProjectStatus;
      chainId: number | null;
      escrowContractAddress: string | null;
      onChainProjectId: string | null;
      paymentTokenAddress: string | null;
      totalValueWei: string | null;
      client: {
        id: string;
        walletAddress: string;
        profile: { displayName: string; avatarUrl: string | null } | null;
      };
      freelancer: {
        id: string;
        walletAddress: string;
        profile: { displayName: string; avatarUrl: string | null } | null;
      } | null;
    };
  };
}): Promise<AdminDisputeDetail> {
  const [fundedRows, releasedRows, recentTxRaw, resolutionTx, emergencyProposalRow] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ funded: string | null }>>(Prisma.sql`
      SELECT COALESCE(
        MAX(
          CASE
            WHEN tl."eventName" = 'ProjectFunded'
              THEN COALESCE(
                NULLIF(tl."payload"->>'fundedAmountAfter', '')::numeric,
                NULLIF(tl."payload"->>'fundedAmountWei', '')::numeric
              )
            ELSE NULL
          END
        ),
        SUM(
          CASE
            WHEN tl."eventName" = 'ProjectFunded'
              THEN COALESCE(NULLIF(tl."payload"->>'amount', '')::numeric, 0)
            ELSE 0
          END
        ),
        0
      )::text AS funded
      FROM "transaction_logs" tl
      WHERE tl."projectId" = ${dispute.milestone.project.id}
        AND tl."sourceType" = ${TransactionLogSourceType.chain_event}::"TransactionLogSourceType"
    `),
    prisma.$queryRaw<Array<{ released: string | null }>>(Prisma.sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN tl."eventName" = 'MilestoneFundsReleased'
            THEN COALESCE(NULLIF(tl."payload"->>'amount', '')::numeric, 0)
          WHEN tl."eventName" = 'DisputeResolved'
            THEN COALESCE(NULLIF(tl."payload"->>'freelancerAmount', '')::numeric, 0)
          ELSE 0
        END
      ), 0)::text AS released
      FROM "transaction_logs" tl
      WHERE tl."projectId" = ${dispute.milestone.project.id}
        AND tl."sourceType" = ${TransactionLogSourceType.chain_event}::"TransactionLogSourceType"
    `),
    prisma.transactionLog.findMany({
      where: {
        OR: [
          { milestoneId: dispute.milestoneId },
          { projectId: dispute.milestone.project.id },
        ],
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: 12,
      select: {
        chainId: true,
        txHash: true,
        blockNumber: true,
        logIndex: true,
        eventName: true,
        sourceType: true,
        fromAddress: true,
        toAddress: true,
        payload: true,
        createdAt: true,
      },
    }),
    prisma.transactionLog.findFirst({
      where: {
        milestoneId: dispute.milestoneId,
        eventName: "DisputeResolved",
        sourceType: TransactionLogSourceType.chain_event,
      },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    }),
    prisma.emergencyResolutionProposal.findFirst({
      where: {
        chainId: dispute.milestone.project.chainId ?? undefined,
        contractAddress: dispute.milestone.project.escrowContractAddress ?? undefined,
        projectId: dispute.milestone.project.onChainProjectId ?? undefined,
        milestoneIndex: dispute.milestone.sortOrder,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        status: true,
        actionHash: true,
        kind: true,
        freelancerAmount: true,
        clientAmount: true,
        readyAt: true,
        txHash: true,
        logIndex: true,
        updatedAt: true,
      },
    }),
  ]);

  const resolutionPayload =
    resolutionTx?.payload && typeof resolutionTx.payload === "object"
      ? (resolutionTx.payload as Record<string, unknown>)
      : null;
  const rawKind =
    resolutionPayload && typeof resolutionPayload.kind === "string"
      ? resolutionPayload.kind
      : null;
  const normalizedKind =
    rawKind === "PAYOUT_TO_FREELANCER" ||
    rawKind === "REFUND_TO_CLIENT" ||
    rawKind === "SPLIT"
      ? rawKind
      : null;

  return {
    id: dispute.id,
    milestoneId: dispute.milestoneId,
    status: dispute.status,
    title: dispute.title,
    evidenceIpfsUri: dispute.evidenceIpfsUri,
    openedBy: toUserPublicRef(dispute.openedBy),
    relatedSubmissionId: dispute.relatedSubmissionId,
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    resolutionTxHash: dispute.resolutionTxHash,
    createdAt: dispute.createdAt.toISOString(),
    description: dispute.description,
    resolvedBy: dispute.resolvedBy ? toUserPublicRef(dispute.resolvedBy) : null,
    updatedAt: dispute.updatedAt.toISOString(),
    project: {
      id: dispute.milestone.project.id,
      title: dispute.milestone.project.title,
      status: dispute.milestone.project.status,
      chainId: dispute.milestone.project.chainId,
      escrowContractAddress: dispute.milestone.project.escrowContractAddress,
      onChainProjectId: dispute.milestone.project.onChainProjectId,
      paymentTokenAddress: dispute.milestone.project.paymentTokenAddress,
      totalValueWei: dispute.milestone.project.totalValueWei,
      fundedAmountWei: fundedRows[0]?.funded ?? "0",
      releasedAmountWei: releasedRows[0]?.released ?? "0",
    },
    milestone: {
      id: dispute.milestone.id,
      sortOrder: dispute.milestone.sortOrder,
      title: dispute.milestone.title,
      status: dispute.milestone.status,
      amountWei: dispute.milestone.amountWei,
      dueAt: dispute.milestone.dueAt?.toISOString() ?? null,
      latestSubmissionId: dispute.milestone.submissions[0]?.id ?? null,
    },
    participants: {
      client: toUserPublicRef(dispute.milestone.project.client),
      freelancer: dispute.milestone.project.freelancer
        ? toUserPublicRef(dispute.milestone.project.freelancer)
        : null,
    },
    relatedSubmission: dispute.relatedSubmission
      ? {
          id: dispute.relatedSubmission.id,
          status: dispute.relatedSubmission.status,
          submittedAt: dispute.relatedSubmission.submittedAt?.toISOString() ?? null,
          note: dispute.relatedSubmission.summary ?? null,
        }
      : null,
    evidenceLinks: [dispute.evidenceIpfsUri],
    resolution: normalizedKind
      ? {
          kind: normalizedKind,
          freelancerAmountWei:
            typeof resolutionPayload?.freelancerAmount === "string"
              ? resolutionPayload.freelancerAmount
              : null,
          clientAmountWei:
            typeof resolutionPayload?.clientAmount === "string"
              ? resolutionPayload.clientAmount
              : null,
          note: typeof resolutionPayload?.note === "string" ? resolutionPayload.note : null,
        }
      : null,
    emergencyResolutionProposal: emergencyProposalRow
      ? {
          status: emergencyProposalRow.status,
          actionHash: emergencyProposalRow.actionHash,
          kind: emergencyProposalRow.kind,
          freelancerAmountWei: emergencyProposalRow.freelancerAmount,
          clientAmountWei: emergencyProposalRow.clientAmount,
          readyAt: emergencyProposalRow.readyAt?.toISOString() ?? null,
          txHash: emergencyProposalRow.txHash,
          logIndex: emergencyProposalRow.logIndex,
          updatedAt: emergencyProposalRow.updatedAt.toISOString(),
        }
      : null,
    recentTransactions: recentTxRaw.map((tx) => {
      const payloadObject = tx.payload && typeof tx.payload === "object" ? tx.payload : null;
      const blockTimestampRaw =
        payloadObject && "blockTimestamp" in payloadObject
          ? (payloadObject.blockTimestamp as unknown)
          : null;
      const amountRaw =
        payloadObject && "amount" in payloadObject
          ? (payloadObject.amount as unknown)
          : payloadObject && "freelancerAmount" in payloadObject
            ? (payloadObject.freelancerAmount as unknown)
            : null;
      return {
        chainId: tx.chainId,
        txHash: tx.txHash,
        blockNumber: tx.blockNumber.toString(),
        logIndex: tx.logIndex,
        eventName: tx.eventName,
        sourceType: tx.sourceType,
        fromAddress: tx.fromAddress,
        toAddress: tx.toAddress,
        amountWei: typeof amountRaw === "string" ? amountRaw : null,
        createdAt: tx.createdAt.toISOString(),
        blockTimestamp: typeof blockTimestampRaw === "string" ? blockTimestampRaw : null,
      };
    }),
  };
}

function toUserPublicRef(user: {
  id: string;
  walletAddress: string;
  profile: { displayName: string; avatarUrl: string | null } | null;
}): UserPublicRef {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    displayName: user.profile?.displayName ?? null,
    avatarUrl: user.profile?.avatarUrl ?? null,
  };
}
