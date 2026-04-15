import { ProjectStatus } from "@prisma/client";

import type { ReconcileFundingBody } from "@/server/validation/schemas/funding";
import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { AppError } from "@/server/errors/app-error";
import { notifyProjectFunded } from "@/server/services/notification-events";

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
