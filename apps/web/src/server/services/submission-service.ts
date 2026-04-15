import {
  MilestoneStatus,
  ProjectStatus,
  SubmissionStatus,
} from "@prisma/client";

import type {
  CreateSubmissionResponse,
  IpfsFileRef,
  MilestoneSubmissionMetadata,
  SubmissionDetail,
  UserPublicRef,
} from "@escrowflow/types";

import type { CreateMilestoneSubmissionBody } from "@/server/validation/schemas/submissions";
import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { uploadFileToIpfs, uploadJsonToIpfs } from "@/lib/ipfs";
import { AppError } from "@/server/errors/app-error";

const ALLOWED_PROJECT_STATUSES = new Set<ProjectStatus>([ProjectStatus.ACTIVE]);
const ALLOWED_MILESTONE_STATUSES = new Set<MilestoneStatus>([
  MilestoneStatus.FUNDED,
  MilestoneStatus.IN_PROGRESS,
  MilestoneStatus.REJECTED,
]);

export async function createMilestoneSubmissionForFreelancer(input: {
  projectId: string;
  milestoneId: string;
  freelancerUserId: string;
  payload: CreateMilestoneSubmissionBody;
}): Promise<CreateSubmissionResponse> {
  const context = await loadMilestoneSubmissionContext(
    input.projectId,
    input.milestoneId,
  );

  ensureFreelancerMembership(context, input.freelancerUserId);
  ensureProjectState(context.project.status);
  ensureMilestoneState(context.milestone.status);

  const deliverableFiles = await uploadDeliverableFilesToIpfs(input.payload.files);
  const metadataUpload = await uploadSubmissionMetadataToIpfs({
    projectId: context.project.id,
    milestoneId: context.milestone.id,
    milestoneIndex: context.milestone.sortOrder,
    submissionRound: context.nextAttemptNumber,
    note: input.payload.note ?? null,
    externalLink: input.payload.externalLink ?? null,
    createdByWallet: context.freelancer.walletAddress,
    deliverables: deliverableFiles,
  });

  const now = new Date();
  const created = await prisma.$transaction(
    async (tx) => {
      const submission = await tx.submission.create({
        data: {
          milestoneId: context.milestone.id,
          submittedByUserId: input.freelancerUserId,
          status: SubmissionStatus.SUBMITTED,
          attemptNumber: context.nextAttemptNumber,
          deliverablesIpfsUri: metadataUpload.uri,
          summary: input.payload.note ?? null,
          submittedAt: now,
        },
        include: {
          submittedBy: { include: { profile: true } },
        },
      });

      await tx.milestone.update({
        where: { id: context.milestone.id },
        data: {
          status: MilestoneStatus.SUBMITTED,
        },
      });

      await tx.transactionLog.create({
        data: {
          chainId: 0,
          blockNumber: 0n,
          txHash: `offchain-submission-${submission.id}`,
          logIndex: -1,
          eventName: "MilestoneSubmissionCreated",
          projectId: context.project.id,
          milestoneId: context.milestone.id,
          initiatedByUserId: input.freelancerUserId,
          fromAddress: context.freelancer.walletAddress.toLowerCase(),
          toAddress: null,
          payload: {
            submissionId: submission.id,
            milestoneId: context.milestone.id,
            note: input.payload.note ?? null,
            externalLink: input.payload.externalLink ?? null,
            metadataIpfsUri: metadataUpload.uri,
            deliverableFiles,
            source: "freelancer_submit",
          },
        },
      });

      return submission;
    },
    prismaInteractiveTransactionOptions,
  );

  return {
    submission: mapSubmissionDetail(created, {
      metadataIpfsUri: metadataUpload.uri,
      externalLink: input.payload.externalLink ?? null,
      deliverableFiles,
    }),
  };
}

async function loadMilestoneSubmissionContext(projectId: string, milestoneId: string) {
  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId },
    include: {
      project: {
        select: {
          id: true,
          status: true,
          freelancerUserId: true,
        },
      },
      _count: {
        select: { submissions: true },
      },
    },
  });

  if (!milestone) {
    throw AppError.notFound("MILESTONE_NOT_FOUND", "Milestone not found in this project");
  }
  if (!milestone.project.freelancerUserId) {
    throw new AppError(
      "PROJECT_FREELANCER_UNASSIGNED",
      "Project does not have an assigned freelancer",
      409,
    );
  }

  const freelancer = await prisma.user.findUnique({
    where: { id: milestone.project.freelancerUserId },
    select: { id: true, walletAddress: true, profile: true },
  });
  if (!freelancer) {
    throw AppError.notFound("FREELANCER_NOT_FOUND", "Assigned freelancer user not found");
  }

  return {
    project: milestone.project,
    milestone: milestone,
    freelancer,
    nextAttemptNumber: milestone._count.submissions + 1,
  };
}

function ensureFreelancerMembership(
  context: {
    project: { freelancerUserId: string | null };
  },
  freelancerUserId: string,
): void {
  if (context.project.freelancerUserId !== freelancerUserId) {
    throw AppError.forbidden("Only the assigned freelancer can submit deliverables");
  }
}

function ensureProjectState(projectStatus: ProjectStatus): void {
  if (!ALLOWED_PROJECT_STATUSES.has(projectStatus)) {
    throw new AppError(
      "PROJECT_STATE_INVALID_FOR_SUBMISSION",
      "Project is not in a state that allows milestone submissions",
      409,
      { projectStatus },
    );
  }
}

function ensureMilestoneState(milestoneStatus: MilestoneStatus): void {
  if (!ALLOWED_MILESTONE_STATUSES.has(milestoneStatus)) {
    throw new AppError(
      "MILESTONE_STATE_INVALID_FOR_SUBMISSION",
      "Milestone is not ready for submission",
      409,
      { milestoneStatus },
    );
  }
}

async function uploadDeliverableFilesToIpfs(
  files: Array<{ fileName: string; mimeType: string; fileBase64: string }>,
): Promise<IpfsFileRef[]> {
  const uploaded = await Promise.all(
    files.map(async (file) => {
      const bytes = Buffer.from(file.fileBase64, "base64");
      if (bytes.length === 0) {
        throw new AppError("DELIVERABLE_FILE_EMPTY", "Deliverable file is empty", 400);
      }
      const result = await uploadFileToIpfs({
        file: bytes,
        fileName: file.fileName,
        mimeType: file.mimeType,
        metadataName: `submission-file-${Date.now()}-${file.fileName}`,
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

async function uploadSubmissionMetadataToIpfs(input: {
  projectId: string;
  milestoneId: string;
  milestoneIndex: number;
  submissionRound: number;
  note: string | null;
  externalLink: string | null;
  createdByWallet: string;
  deliverables: IpfsFileRef[];
}): Promise<{ uri: string }> {
  const metadata: MilestoneSubmissionMetadata = {
    schemaVersion: 1,
    schema: "escrowflow.milestone-submission.v1",
    createdAt: new Date().toISOString(),
    createdByWallet: input.createdByWallet,
    app: "escrowflow",
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    milestoneIndex: input.milestoneIndex,
    submissionRound: input.submissionRound,
    notes: input.note ?? undefined,
    externalLink: input.externalLink ?? undefined,
    deliverables: input.deliverables,
  };

  const uploaded = await uploadJsonToIpfs(metadata as unknown as Record<string, unknown>, {
    metadataName: `submission-metadata-${input.milestoneId}-${input.submissionRound}`,
    keyvalues: {
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      kind: "milestone-submission",
    },
  });
  return { uri: uploaded.uri };
}

function mapSubmissionDetail(
  submission: {
    id: string;
    milestoneId: string;
    status: SubmissionStatus;
    attemptNumber: number;
    deliverablesIpfsUri: string;
    summary: string | null;
    submittedAt: Date | null;
    decidedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    submittedBy: {
      id: string;
      walletAddress: string;
      profile: { displayName: string; avatarUrl: string | null } | null;
    };
  },
  extras: {
    metadataIpfsUri: string;
    externalLink: string | null;
    deliverableFiles: IpfsFileRef[];
  },
): SubmissionDetail {
  return {
    id: submission.id,
    milestoneId: submission.milestoneId,
    status: submission.status,
    attemptNumber: submission.attemptNumber,
    deliverablesIpfsUri: submission.deliverablesIpfsUri,
    summary: submission.summary,
    note: submission.summary,
    externalLink: extras.externalLink,
    metadataIpfsUri: extras.metadataIpfsUri,
    deliverableFiles: extras.deliverableFiles,
    submittedBy: toUserPublicRef(submission.submittedBy),
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    decidedAt: submission.decidedAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString(),
    updatedAt: submission.updatedAt.toISOString(),
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
