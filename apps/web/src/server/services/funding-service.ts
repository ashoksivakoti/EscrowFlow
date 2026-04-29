import {
  MilestoneStatus,
  ProjectStatus,
  TransactionLogSourceType,
} from "@prisma/client";

import type { ReconcileFundingBody } from "@/server/validation/schemas/funding";
import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { AppError } from "@/server/errors/app-error";
import { notifyProjectFunded } from "@/server/services/notification-events";

/**
 * Aligns DB milestone rows with on-chain funding: milestone `i` is fundable when
 * `fundedWei >= sum(amountWei[0..i])` (same rule as EscrowFlowRegistry cumulative funding).
 * Only promotes {@link MilestoneStatus.PLANNED} / {@link MilestoneStatus.AWAITING_FUNDS} → {@link MilestoneStatus.FUNDED}.
 */
export function milestoneFundingSyncUpdates(
  milestones: ReadonlyArray<{
    id: string;
    sortOrder: number;
    status: MilestoneStatus;
    amountWei: string;
    fundedAt: Date | null;
  }>,
  fundedWei: bigint,
  now: Date,
): { id: string; status: MilestoneStatus; fundedAt: Date }[] {
  const sorted = [...milestones].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return a.id.localeCompare(b.id);
  });

  const updates: { id: string; status: MilestoneStatus; fundedAt: Date }[] = [];
  let cumulative = 0n;
  for (const m of sorted) {
    cumulative += BigInt(m.amountWei);
    if (fundedWei < cumulative) {
      continue;
    }
    if (m.status === MilestoneStatus.PLANNED || m.status === MilestoneStatus.AWAITING_FUNDS) {
      updates.push({
        id: m.id,
        status: MilestoneStatus.FUNDED,
        fundedAt: m.fundedAt ?? now,
      });
    }
  }
  return updates;
}

export async function reconcileProjectFunding(
  projectId: string,
  userId: string,
  payload: ReconcileFundingBody,
): Promise<{
  projectId: string;
  fundedAmountWei: string;
  totalValueWei: string | null;
  status: ProjectStatus;
}> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      clientUserId: true,
      freelancerUserId: true,
      totalValueWei: true,
    },
  });
  if (!project) {
    throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  if (project.clientUserId !== userId) {
    throw AppError.forbidden("Only the project client can reconcile funding");
  }

  const funded = BigInt(payload.fundedAmountWei);
  const total = project.totalValueWei ? BigInt(project.totalValueWei) : null;
  const nextStatus =
    total !== null && funded >= total ? ProjectStatus.ACTIVE : ProjectStatus.AWAITING_ESCROW;

  await prisma.$transaction(
    async (tx) => {
      const milestones = await tx.milestone.findMany({
        where: { projectId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, sortOrder: true, status: true, amountWei: true, fundedAt: true },
      });

      const now = new Date();
      const milestoneUpdates = milestoneFundingSyncUpdates(milestones, funded, now);
      for (const row of milestoneUpdates) {
        await tx.milestone.update({
          where: { id: row.id },
          data: { status: row.status, fundedAt: row.fundedAt },
        });
      }

      await tx.project.update({
        where: { id: projectId },
        data: {
          chainId: payload.chainId,
          escrowContractAddress: payload.escrowContractAddress.toLowerCase(),
          onChainProjectId: payload.onChainProjectId,
          status: nextStatus,
        },
      });

      await tx.transactionLog.upsert({
        where: {
          chainId_txHash_logIndex: {
            chainId: payload.chainId,
            txHash: payload.txHash.toLowerCase(),
            logIndex: -1,
          },
        },
        update: {
          sourceType: TransactionLogSourceType.synthetic_client_reconcile,
          payload: {
            projectId,
            fundedAmountWei: payload.fundedAmountWei,
            source: "client_reconcile",
          },
        },
        create: {
          chainId: payload.chainId,
          blockNumber: 0n,
          txHash: payload.txHash.toLowerCase(),
          logIndex: -1,
          eventName: "ProjectFunded",
          sourceType: TransactionLogSourceType.synthetic_client_reconcile,
          projectId,
          initiatedByUserId: userId,
          fromAddress: null,
          toAddress: payload.escrowContractAddress.toLowerCase(),
          payload: {
            projectId,
            fundedAmountWei: payload.fundedAmountWei,
            onChainProjectId: payload.onChainProjectId,
            source: "client_reconcile",
          },
        },
      });
    },
    prismaInteractiveTransactionOptions,
  );

  void notifyProjectFunded({
    projectId: project.id,
    projectTitle: project.title,
    clientUserId: project.clientUserId,
    freelancerUserId: project.freelancerUserId,
  }).catch(() => undefined);

  return {
    projectId,
    fundedAmountWei: payload.fundedAmountWei,
    totalValueWei: project.totalValueWei,
    status: nextStatus,
  };
}
