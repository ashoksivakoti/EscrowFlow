import {
  DisputeStatus,
  MilestoneStatus,
  ProjectStatus,
  TransactionLogSourceType,
} from "@prisma/client";

import type {
  CreateDisputeResponse,
  DisputeDetail,
  DisputeEvidenceMetadata,
  IpfsFileRef,
  UserPublicRef,
} from "@escrowflow/types";

import type { CreateMilestoneDisputeBody } from "@/server/validation/schemas/disputes";
import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { uploadFileToIpfs, uploadJsonToIpfs } from "@/lib/ipfs";
import { AppError } from "@/server/errors/app-error";
import { notifyDisputeRaised } from "@/server/services/notification-events";

const ALLOWED_PROJECT_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.ACTIVE,
  ProjectStatus.DISPUTED,
]);
const ALLOWED_MILESTONE_STATUSES = new Set<MilestoneStatus>([
  MilestoneStatus.SUBMITTED,
  MilestoneStatus.APPROVED,
]);

export async function createMilestoneDisputeForParticipant(input: {
  projectId: string;
  milestoneId: string;
  openedByUserId: string;
  payload: CreateMilestoneDisputeBody;
}): Promise<CreateDisputeResponse> {
  const context = await loadDisputeContext(input.projectId, input.milestoneId, input.openedByUserId);
  ensureProjectState(context.project.status);
  ensureMilestoneState(context.milestone.status);
  ensureNoOpenDispute(context.openDisputeExists);
  ensureRelatedSubmission(context.submissionExists, input.payload.relatedSubmissionId ?? null);
  ensureOnChainLinkage(context, input.payload);

  const evidenceFiles = await uploadEvidenceFilesToIpfs(input.payload.files);
  const openedByRole = resolveSubmittedByRole(
    input.openedByUserId,
    context.project.clientUserId,
    context.project.freelancerUserId,
  );
  const evidenceMetadata = await uploadDisputeMetadataToIpfs({
    projectId: context.project.id,
    milestoneId: context.milestone.id,
    openedByWallet: context.openedBy.walletAddress,
    openedByRole,
    reason: input.payload.reason,
    evidenceFiles,
    relatedSubmissionUris: context.relatedSubmissionUris,
  });

  const now = new Date();
  const created = await prisma.$transaction(
    async (tx) => {
      const dispute = await tx.dispute.create({
        data: {
          milestoneId: context.milestone.id,
          relatedSubmissionId: input.payload.relatedSubmissionId ?? null,
          openedByUserId: input.openedByUserId,
          status: DisputeStatus.OPEN,
          title: "Milestone dispute",
          description: input.payload.reason,
          evidenceIpfsUri: evidenceMetadata.uri,
        },
        include: {
          openedBy: { include: { profile: true } },
          resolvedBy: { include: { profile: true } },
        },
      });

      await tx.milestone.update({
        where: { id: context.milestone.id },
        data: { status: MilestoneStatus.DISPUTED },
      });

      await tx.project.update({
        where: { id: context.project.id },
        data: {
          status: ProjectStatus.DISPUTED,
        },
      });

      await tx.transactionLog.create({
        data: {
          chainId: input.payload.chainId,
          blockNumber: 0n,
          txHash: input.payload.disputeTxHash,
          logIndex: -1,
          eventName: "DisputeRaised",
          sourceType: TransactionLogSourceType.synthetic_client_reconcile,
          projectId: context.project.id,
          milestoneId: context.milestone.id,
          initiatedByUserId: input.openedByUserId,
          fromAddress: context.openedBy.walletAddress.toLowerCase(),
          toAddress: input.payload.escrowContractAddress,
          payload: {
            disputeId: dispute.id,
            reason: input.payload.reason,
            reasonUri: input.payload.reasonUri,
            evidenceIpfsUri: evidenceMetadata.uri,
            evidenceFiles,
            relatedSubmissionId: input.payload.relatedSubmissionId ?? null,
            onChainProjectId: input.payload.onChainProjectId,
            milestoneIndex: input.payload.milestoneIndex,
            source: "onchain_participant_dispute_reconcile",
          },
        },
      });

      return dispute;
    },
    prismaInteractiveTransactionOptions,
  );

  void notifyDisputeRaised({
    projectId: context.project.id,
    milestoneId: context.milestone.id,
    milestoneTitle: context.milestone.title,
    openedByUserId: input.openedByUserId,
    clientUserId: context.project.clientUserId,
    freelancerUserId: context.project.freelancerUserId,
    disputeId: created.id,
  }).catch(() => undefined);

  return {
    dispute: mapDisputeDetail(created, now),
  };
}

async function loadDisputeContext(projectId: string, milestoneId: string, openedByUserId: string) {
  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId },
    include: {
      project: {
        select: {
          id: true,
          title: true,
          status: true,
          chainId: true,
          escrowContractAddress: true,
          onChainProjectId: true,
          clientUserId: true,
          freelancerUserId: true,
        },
      },
      disputes: {
        where: {
          status: {
            in: [DisputeStatus.OPEN, DisputeStatus.AWAITING_RESPONSE, DisputeStatus.UNDER_ADMIN_REVIEW],
          },
        },
        select: { id: true },
        take: 1,
      },
      submissions: {
        select: { id: true, deliverablesIpfsUri: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
  if (!milestone) {
    throw AppError.notFound("MILESTONE_NOT_FOUND", "Milestone not found in this project");
  }

  const isParticipant =
    milestone.project.clientUserId === openedByUserId ||
    milestone.project.freelancerUserId === openedByUserId;
  if (!isParticipant) {
    throw AppError.forbidden("Only project participants can raise disputes");
  }

  const openedBy = await prisma.user.findUnique({
    where: { id: openedByUserId },
    select: { id: true, walletAddress: true, profile: true },
  });
  if (!openedBy) {
    throw AppError.notFound("USER_NOT_FOUND", "Authenticated user not found");
  }

  return {
    project: milestone.project,
    milestone,
    openedBy,
    openDisputeExists: milestone.disputes.length > 0,
    submissionExists: new Set(milestone.submissions.map((s) => s.id)),
    relatedSubmissionUris: milestone.submissions
      .map((s) => s.deliverablesIpfsUri)
      .filter((value): value is string => Boolean(value)),
  };
}

function ensureProjectState(status: ProjectStatus): void {
  if (!ALLOWED_PROJECT_STATUSES.has(status)) {
    throw new AppError(
      "PROJECT_STATE_INVALID_FOR_DISPUTE",
      "Project is not in a state that allows dispute creation",
      409,
      { projectStatus: status },
    );
  }
}

function ensureMilestoneState(status: MilestoneStatus): void {
  if (!ALLOWED_MILESTONE_STATUSES.has(status)) {
    throw new AppError(
      "MILESTONE_STATE_INVALID_FOR_DISPUTE",
      "Milestone must be submitted or approved before raising a dispute",
      409,
      { milestoneStatus: status },
    );
  }
}

function ensureNoOpenDispute(openDisputeExists: boolean): void {
  if (openDisputeExists) {
    throw new AppError(
      "MILESTONE_ALREADY_DISPUTED",
      "This milestone already has an active dispute",
      409,
    );
  }
}

function ensureRelatedSubmission(submissionIds: Set<string>, relatedSubmissionId: string | null): void {
  if (relatedSubmissionId && !submissionIds.has(relatedSubmissionId)) {
    throw new AppError(
      "RELATED_SUBMISSION_NOT_FOUND",
      "Related submission does not belong to this milestone",
      400,
    );
  }
}

function ensureOnChainLinkage(
  context: Awaited<ReturnType<typeof loadDisputeContext>>,
  payload: CreateMilestoneDisputeBody,
): void {
  if (
    !context.project.chainId ||
    !context.project.escrowContractAddress ||
    !context.project.onChainProjectId
  ) {
    throw new AppError(
      "PROJECT_ONCHAIN_LINKAGE_REQUIRED",
      "Project must be linked on-chain before dispute reconciliation.",
      409,
    );
  }
  if (payload.chainId !== context.project.chainId) {
    throw new AppError("CHAIN_ID_MISMATCH", "Dispute chain does not match project chain", 400);
  }
  if (payload.escrowContractAddress !== context.project.escrowContractAddress.toLowerCase()) {
    throw new AppError(
      "ESCROW_CONTRACT_MISMATCH",
      "Dispute escrow contract does not match project escrow contract",
      400,
    );
  }
  if (payload.onChainProjectId !== context.project.onChainProjectId) {
    throw new AppError(
      "ONCHAIN_PROJECT_ID_MISMATCH",
      "Dispute on-chain project id does not match project record",
      400,
    );
  }
  if (payload.milestoneIndex !== context.milestone.sortOrder) {
    throw new AppError(
      "MILESTONE_INDEX_MISMATCH",
      "Dispute milestone index does not match milestone sort order",
      400,
    );
  }
}

function resolveSubmittedByRole(
  openedByUserId: string,
  clientUserId: string,
  freelancerUserId: string | null,
): "CLIENT" | "FREELANCER" | "ADMIN" {
  if (openedByUserId === clientUserId) {
    return "CLIENT";
  }
  if (freelancerUserId && openedByUserId === freelancerUserId) {
    return "FREELANCER";
  }
  return "ADMIN";
}

async function uploadEvidenceFilesToIpfs(
  files: Array<{ fileName: string; mimeType: string; fileBase64: string }>,
): Promise<IpfsFileRef[]> {
  const uploaded = await Promise.all(
    files.map(async (file) => {
      const bytes = Buffer.from(file.fileBase64, "base64");
      if (bytes.length === 0) {
        throw new AppError("DISPUTE_EVIDENCE_FILE_EMPTY", "Evidence file is empty", 400);
      }

      const result = await uploadFileToIpfs({
        file: bytes,
        fileName: file.fileName,
        mimeType: file.mimeType,
        metadataName: `dispute-evidence-file-${Date.now()}-${file.fileName}`,
      });
      return {
        cid: result.cid,
        uri: result.uri,
        fileName: file.fileName,
        mimeType: result.contentType,
        sizeBytes: result.sizeBytes,
      } satisfies IpfsFileRef;
    }),
  );
  return uploaded;
}

async function uploadDisputeMetadataToIpfs(input: {
  projectId: string;
  milestoneId: string;
  openedByWallet: string;
  openedByRole: "CLIENT" | "FREELANCER" | "ADMIN";
  reason: string;
  evidenceFiles: IpfsFileRef[];
  relatedSubmissionUris: string[];
}): Promise<{ uri: string }> {
  const metadata: DisputeEvidenceMetadata = {
    schemaVersion: 1,
    schema: "escrowflow.dispute-evidence.v1",
    createdAt: new Date().toISOString(),
    createdByWallet: input.openedByWallet,
    app: "escrowflow",
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    submittedByRole: input.openedByRole,
    claimSummary:
      input.reason.length > 180 ? `${input.reason.slice(0, 177).trimEnd()}...` : input.reason,
    statement: input.reason,
    evidenceFiles: input.evidenceFiles,
    relatedSubmissionUris: input.relatedSubmissionUris,
  };

  const uploaded = await uploadJsonToIpfs(metadata as unknown as Record<string, unknown>, {
    metadataName: `dispute-evidence-${input.milestoneId}-${Date.now()}`,
    keyvalues: {
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      kind: "dispute-evidence",
    },
  });
  return { uri: uploaded.uri };
}

function mapDisputeDetail(
  dispute: {
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
  },
  now: Date,
): DisputeDetail {
  return {
    id: dispute.id,
    milestoneId: dispute.milestoneId,
    status: dispute.status,
    title: dispute.title,
    description: dispute.description,
    evidenceIpfsUri: dispute.evidenceIpfsUri,
    openedBy: toUserPublicRef(dispute.openedBy),
    relatedSubmissionId: dispute.relatedSubmissionId,
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    resolutionTxHash: dispute.resolutionTxHash,
    createdAt: dispute.createdAt?.toISOString() ?? now.toISOString(),
    resolvedBy: dispute.resolvedBy ? toUserPublicRef(dispute.resolvedBy) : null,
    updatedAt: dispute.updatedAt?.toISOString() ?? now.toISOString(),
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
