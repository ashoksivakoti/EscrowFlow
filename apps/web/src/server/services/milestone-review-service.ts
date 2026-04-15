import { MilestoneStatus, ProjectStatus, SubmissionStatus } from "@prisma/client";

import type { ApproveAndPayoutBody } from "@/server/validation/schemas/milestone-review";
import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { AppError } from "@/server/errors/app-error";

export async function reconcileMilestoneApprovalAndPayout(input: {
  projectId: string;
  milestoneId: string;
  clientUserId: string;
  payload: ApproveAndPayoutBody;
}): Promise<{
  projectId: string;
  milestoneId: string;
  submissionId: string;
  releasedAmountWei: string;
  projectReleasedAmountWei: string;
  projectStatus: ProjectStatus;
}> {
  const [project, milestone, submission] = await prisma.$transaction([
    prisma.project.findUnique({ where: { id: input.projectId } }),
    prisma.milestone.findFirst({
      where: { id: input.milestoneId, projectId: input.projectId },
    }),
    prisma.submission.findFirst({
      where: { id: input.payload.submissionId, milestoneId: input.milestoneId },
    }),
  ]);

  if (!project) {
    throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  if (!milestone) {
    throw AppError.notFound("MILESTONE_NOT_FOUND", "Milestone not found in this project");
  }
  if (!submission) {
    throw AppError.notFound("SUBMISSION_NOT_FOUND", "Submission not found for this milestone");
  }
  if (project.clientUserId !== input.clientUserId) {
    throw AppError.forbidden("Only the project client can approve payout");
  }
  if (submission.status === SubmissionStatus.ACCEPTED) {
    throw new AppError("SUBMISSION_ALREADY_ACCEPTED", "Submission is already accepted", 409);
  }

  const now = new Date();

  await prisma.$transaction(
    async (tx) => {
      await tx.submission.update({
        where: { id: submission.id },
        data: {
          status: SubmissionStatus.ACCEPTED,
          decidedAt: now,
        },
      });

      await tx.milestone.update({
        where: { id: milestone.id },
        data: {
          status: MilestoneStatus.RELEASED,
          releasedAt: now,
        },
      });

      await tx.transactionLog.upsert({
        where: {
          chainId_txHash_logIndex: {
            chainId: input.payload.chainId,
            txHash: input.payload.approveTxHash.toLowerCase(),
            logIndex: -1,
          },
        },
        update: {
          payload: {
            projectId: input.projectId,
            milestoneId: input.milestoneId,
            submissionId: submission.id,
            reviewNote: input.payload.reviewNote ?? null,
            source: "client_reconcile",
          },
        },
        create: {
          chainId: input.payload.chainId,
          blockNumber: 0n,
          txHash: input.payload.approveTxHash.toLowerCase(),
          logIndex: -1,
          eventName: "MilestoneApproved",
          projectId: input.projectId,
          milestoneId: input.milestoneId,
          initiatedByUserId: input.clientUserId,
          fromAddress: null,
          toAddress: input.payload.escrowContractAddress.toLowerCase(),
          payload: {
            projectId: input.projectId,
            milestoneId: input.milestoneId,
            submissionId: submission.id,
            reviewNote: input.payload.reviewNote ?? null,
            onChainProjectId: input.payload.onChainProjectId,
            milestoneIndex: input.payload.milestoneIndex,
            source: "client_reconcile",
          },
        },
      });

      await tx.transactionLog.upsert({
        where: {
          chainId_txHash_logIndex: {
            chainId: input.payload.chainId,
            txHash: input.payload.releaseTxHash.toLowerCase(),
            logIndex: -1,
          },
        },
        update: {
          payload: {
            projectId: input.projectId,
            milestoneId: input.milestoneId,
            submissionId: submission.id,
            amount: input.payload.releasedAmountWei,
            source: "client_reconcile",
          },
        },
        create: {
          chainId: input.payload.chainId,
          blockNumber: 0n,
          txHash: input.payload.releaseTxHash.toLowerCase(),
          logIndex: -1,
          eventName: "MilestoneFundsReleased",
          projectId: input.projectId,
          milestoneId: input.milestoneId,
          initiatedByUserId: input.clientUserId,
          fromAddress: null,
          toAddress: input.payload.escrowContractAddress.toLowerCase(),
          payload: {
            projectId: input.projectId,
            milestoneId: input.milestoneId,
            submissionId: submission.id,
            amount: input.payload.releasedAmountWei,
            onChainProjectId: input.payload.onChainProjectId,
            milestoneIndex: input.payload.milestoneIndex,
            source: "client_reconcile",
          },
        },
      });
    },
    prismaInteractiveTransactionOptions,
  );

  const releasedMilestoneCount = await prisma.milestone.count({
    where: {
      projectId: input.projectId,
      status: MilestoneStatus.RELEASED,
    },
  });

  const projectMilestoneCount = await prisma.milestone.count({
    where: { projectId: input.projectId },
  });

  const nextProjectStatus =
    projectMilestoneCount > 0 && releasedMilestoneCount === projectMilestoneCount
      ? ProjectStatus.COMPLETED
      : ProjectStatus.ACTIVE;

  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      status: nextProjectStatus,
      completedAt: nextProjectStatus === ProjectStatus.COMPLETED ? now : null,
    },
  });

  const releasedAmountWei = input.payload.releasedAmountWei;
  const projectReleasedAmountWei = await sumProjectReleasedAmount(input.projectId);

  return {
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    submissionId: submission.id,
    releasedAmountWei,
    projectReleasedAmountWei,
    projectStatus: nextProjectStatus,
  };
}

async function sumProjectReleasedAmount(projectId: string): Promise<string> {
  const logs = await prisma.transactionLog.findMany({
    where: {
      projectId,
      eventName: { in: ["MilestoneFundsReleased", "DisputeResolved"] },
    },
    select: { payload: true },
  });
  const total = logs.reduce((acc, item) => {
    const payload =
      item.payload && typeof item.payload === "object" ? (item.payload as Record<string, unknown>) : {};
    const raw =
      typeof payload.amount === "string"
        ? payload.amount
        : typeof payload.freelancerAmount === "string"
          ? payload.freelancerAmount
          : "0";
    try {
      return acc + BigInt(raw);
    } catch {
      return acc;
    }
  }, 0n);
  return total.toString();
}
