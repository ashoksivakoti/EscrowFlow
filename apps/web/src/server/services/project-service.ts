import { DisputeStatus, PlatformRole, Prisma, ProjectStatus } from "@prisma/client";
import { getAddress } from "viem";

import type {
  CreateProjectBody,
  ListProjectsQuery as ListProjectsInput,
} from "@/server/validation/schemas/projects";
import type {
  CreateProjectResponse,
  ListProjectsResponse,
  ProjectSummary,
  MilestoneSummary,
  ProjectDetail,
  ProjectDisputePreview,
  ProjectSubmissionPreview,
  ProjectTransactionHistoryItem,
  UserPublicRef,
} from "@escrowflow/types";

import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { uploadFileToIpfs, uploadJsonToIpfs } from "@/lib/ipfs";
import { AppError } from "@/server/errors/app-error";

function normalizeWalletOrThrow(raw: string): string {
  try {
    return getAddress(raw).toLowerCase();
  } catch {
    throw new AppError("INVALID_WALLET_ADDRESS", "Invalid wallet address", 400);
  }
}

export async function createProjectForClient(
  clientUserId: string,
  payload: CreateProjectBody,
): Promise<CreateProjectResponse> {
  const freelancerWallet = normalizeWalletOrThrow(payload.freelancerWalletAddress);
  const paymentTokenAddress = payload.paymentTokenAddress
    ? normalizeWalletOrThrow(payload.paymentTokenAddress)
    : null;
  const escrowContractAddress = payload.escrowContractAddress
    ? normalizeWalletOrThrow(payload.escrowContractAddress)
    : null;

  const freelancer = await prisma.user.findUnique({
    where: { walletAddress: freelancerWallet },
    include: {
      profile: true,
      platformRoles: true,
    },
  });
  if (!freelancer) {
    throw AppError.notFound(
      "FREELANCER_NOT_FOUND",
      "Freelancer wallet does not map to a registered user",
    );
  }
  const hasFreelancerRole = freelancer.platformRoles.some(
    (role) => role.role === PlatformRole.FREELANCER,
  );
  if (!hasFreelancerRole) {
    throw new AppError(
      "FREELANCER_ROLE_REQUIRED",
      "Selected freelancer does not have FREELANCER role",
      409,
    );
  }
  if (freelancer.id === clientUserId) {
    throw new AppError(
      "INVALID_FREELANCER",
      "Client and freelancer must be different users",
      400,
    );
  }

  const agreementIpfsUri = await maybeUploadAgreement(payload);

  const totalValueWei = payload.milestones
    .reduce((acc, m) => acc + BigInt(m.amountWei), 0n)
    .toString();

  const created = await prisma.$transaction(
    async (tx) => {
      const project = await tx.project.create({
        data: {
          clientUserId,
          freelancerUserId: freelancer.id,
          status: ProjectStatus.AWAITING_ESCROW,
          title: payload.title,
          description: payload.description ?? null,
          agreementIpfsUri: agreementIpfsUri ?? null,
          chainId: payload.chainId ?? null,
          escrowContractAddress: escrowContractAddress ?? null,
          onChainProjectId: payload.onChainProjectId ?? null,
          paymentTokenAddress,
          totalValueWei,
          milestones: {
            create: payload.milestones.map((m, index) => ({
              sortOrder: index,
              title: m.title,
              description: m.description ?? null,
              amountWei: m.amountWei,
              dueAt: new Date(m.dueAt),
            })),
          },
        },
        include: {
          client: { include: { profile: true } },
          freelancer: { include: { profile: true } },
          milestones: { orderBy: { sortOrder: "asc" } },
        },
      });
      return project;
    },
    prismaInteractiveTransactionOptions,
  );

  return { project: mapProjectDetail(created) };
}

async function maybeUploadAgreement(payload: CreateProjectBody): Promise<string | null> {
  if (!payload.agreement) {
    return null;
  }

  try {
    if (payload.agreement.mode === "metadata") {
      const uploaded = await uploadJsonToIpfs(payload.agreement.metadata, {
        metadataName: `project-agreement-metadata-${Date.now()}`,
      });
      return uploaded.uri;
    }

    const bytes = Buffer.from(payload.agreement.fileBase64, "base64");
    if (bytes.length === 0) {
      throw new AppError("AGREEMENT_FILE_EMPTY", "Agreement file is empty", 400);
    }
    const uploaded = await uploadFileToIpfs({
      file: bytes,
      fileName: payload.agreement.fileName,
      mimeType: payload.agreement.mimeType,
      metadataName: `project-agreement-file-${Date.now()}`,
    });
    return uploaded.uri;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "AGREEMENT_UPLOAD_FAILED",
      "Agreement upload to IPFS failed",
      502,
      {
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

function mapProjectDetail(project: {
  id: string;
  status: ProjectStatus;
  title: string;
  description: string | null;
  chainId: number | null;
  escrowContractAddress: string | null;
  onChainProjectId: string | null;
  paymentTokenAddress: string | null;
  totalValueWei: string | null;
  agreementIpfsUri: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  milestones: Array<{
    id: string;
    projectId: string;
    sortOrder: number;
    title: string;
    status: string;
    amountWei: string;
    dueAt: Date | null;
    specificationIpfsUri: string | null;
    fundedAt: Date | null;
    releasedAt: Date | null;
    updatedAt: Date;
    submissions?: Array<{ id: string }>;
    disputes?: Array<{ id: string }>;
  }>;
}, extras?: {
  fundedAmountWei?: string;
  releasedAmountWei?: string;
  latestSubmission?: ProjectSubmissionPreview | null;
  openDispute?: ProjectDisputePreview | null;
  recentTransactions?: ProjectTransactionHistoryItem[];
}): ProjectDetail {
  const milestones: MilestoneSummary[] = project.milestones.map((m) => ({
    id: m.id,
    projectId: m.projectId,
    sortOrder: m.sortOrder,
    title: m.title,
    status: m.status as MilestoneSummary["status"],
    amountWei: m.amountWei,
    dueAt: m.dueAt?.toISOString() ?? null,
    specificationIpfsUri: m.specificationIpfsUri,
    fundedAt: m.fundedAt?.toISOString() ?? null,
    releasedAt: m.releasedAt?.toISOString() ?? null,
    updatedAt: m.updatedAt.toISOString(),
    latestSubmissionId: m.submissions?.[0]?.id ?? null,
    openDisputeId: m.disputes?.[0]?.id ?? null,
  }));

  return {
    id: project.id,
    status: project.status,
    title: project.title,
    description: project.description,
    chainId: project.chainId,
    escrowContractAddress: project.escrowContractAddress,
    onChainProjectId: project.onChainProjectId,
    paymentTokenAddress: project.paymentTokenAddress,
    totalValueWei: project.totalValueWei,
    fundedAmountWei: extras?.fundedAmountWei ?? "0",
    releasedAmountWei: extras?.releasedAmountWei ?? "0",
    client: toUserPublicRef(project.client),
    freelancer: project.freelancer ? toUserPublicRef(project.freelancer) : null,
    agreementIpfsUri: project.agreementIpfsUri,
    agreementLinks: project.agreementIpfsUri ? [project.agreementIpfsUri] : [],
    milestoneCount: milestones.length,
    openDisputeCount: extras?.openDispute ? 1 : 0,
    updatedAt: project.updatedAt.toISOString(),
    latestSubmission: extras?.latestSubmission ?? null,
    openDispute: extras?.openDispute ?? null,
    recentTransactions: extras?.recentTransactions ?? [],
    milestones,
    completedAt: project.completedAt?.toISOString() ?? null,
    cancelledAt: project.cancelledAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
  };
}

export async function listProjectsForUser(
  userId: string,
  query: ListProjectsInput,
): Promise<ListProjectsResponse> {
  const take = query.limit ?? 24;
  const participation = query.participation ?? "any";
  const sortBy = query.sortBy ?? "updatedAt";
  const sortOrder = query.sortOrder ?? "desc";

  const where =
    participation === "client"
      ? {
          clientUserId: userId,
        }
      : participation === "freelancer"
        ? {
            freelancerUserId: userId,
          }
        : {
            OR: [{ clientUserId: userId }, { freelancerUserId: userId }],
          };

  const rows = await prisma.project.findMany({
    where: {
      ...where,
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.query
        ? {
            OR: [
              { title: { contains: query.query, mode: "insensitive" } },
              { description: { contains: query.query, mode: "insensitive" } },
              {
                client: {
                  walletAddress: { contains: query.query.toLowerCase(), mode: "insensitive" },
                },
              },
              {
                freelancer: {
                  walletAddress: { contains: query.query.toLowerCase(), mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      client: { include: { profile: true } },
      freelancer: { include: { profile: true } },
      milestones: {
        select: { status: true, dueAt: true },
      },
      _count: { select: { milestones: true } },
    },
    orderBy:
      sortBy === "createdAt" || sortBy === "updatedAt"
        ? { [sortBy]: sortOrder }
        : { updatedAt: "desc" },
    take,
  });

  const sortedRows =
    sortBy === "amountWei"
      ? [...rows].sort((a, b) => compareWei(a.totalValueWei, b.totalValueWei, sortOrder))
      : sortBy === "deadline"
        ? [...rows].sort((a, b) =>
            compareDeadline(computeNextDueAt(a.milestones), computeNextDueAt(b.milestones), sortOrder),
          )
        : rows;

  return {
    items: sortedRows.map((row) => mapProjectSummary(row)),
    nextCursor: null,
    hasMore: false,
  };
}

export async function getProjectDetailForUser(
  projectId: string,
  userId: string,
): Promise<ProjectDetail> {
  const [row, latestSubmissionRaw, openDisputeRaw, recentTxRaw, fundedRows, releasedRows] =
    await prisma.$transaction([
      prisma.project.findUnique({
        where: { id: projectId },
        include: {
          client: { include: { profile: true } },
          freelancer: { include: { profile: true } },
          milestones: {
            orderBy: { sortOrder: "asc" },
            include: {
              submissions: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true, status: true, summary: true, submittedAt: true, createdAt: true },
              },
              disputes: {
                where: {
                  status: {
                    in: [
                      DisputeStatus.OPEN,
                      DisputeStatus.AWAITING_RESPONSE,
                      DisputeStatus.UNDER_ADMIN_REVIEW,
                    ],
                  },
                },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      }),
      prisma.submission.findFirst({
        where: { milestone: { projectId } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          milestoneId: true,
          status: true,
          summary: true,
          deliverablesIpfsUri: true,
          submittedAt: true,
          decidedAt: true,
          createdAt: true,
        },
      }),
      prisma.dispute.findFirst({
        where: {
          milestone: { projectId },
          status: {
            in: [
              DisputeStatus.OPEN,
              DisputeStatus.AWAITING_RESPONSE,
              DisputeStatus.UNDER_ADMIN_REVIEW,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          milestoneId: true,
          status: true,
          title: true,
          description: true,
          evidenceIpfsUri: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
      prisma.transactionLog.findMany({
        where: { projectId },
        orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
        take: 20,
        select: {
          txHash: true,
          blockNumber: true,
          logIndex: true,
          eventName: true,
          fromAddress: true,
          toAddress: true,
          payload: true,
          createdAt: true,
        },
      }),
      prisma.$queryRaw<Array<{ funded: string | null }>>(Prisma.sql`
        SELECT COALESCE(
          MAX(
            CASE
              WHEN tl."eventName" = 'ProjectFunded'
                THEN NULLIF(tl."payload"->>'fundedAmountAfter', '')::numeric
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
        WHERE tl."projectId" = ${projectId}
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
        WHERE tl."projectId" = ${projectId}
      `),
    ]);
  if (!row) {
    throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  if (row.clientUserId !== userId && row.freelancerUserId !== userId) {
    throw AppError.forbidden("You are not a participant in this project");
  }
  const latestSubmission = latestSubmissionRaw
    ? await mapLatestSubmissionWithMetadata(latestSubmissionRaw)
    : null;

  return mapProjectDetail(
    row,
    {
      fundedAmountWei: fundedRows[0]?.funded ?? "0",
      releasedAmountWei: releasedRows[0]?.released ?? "0",
      latestSubmission,
      openDispute: openDisputeRaw ? mapDisputePreview(openDisputeRaw) : null,
      recentTransactions: recentTxRaw.map(mapProjectTransactionHistory),
    },
  );
}

function mapProjectSummary(project: {
  id: string;
  status: ProjectStatus;
  title: string;
  chainId: number | null;
  escrowContractAddress: string | null;
  onChainProjectId: string | null;
  paymentTokenAddress: string | null;
  totalValueWei: string | null;
  agreementIpfsUri: string | null;
  updatedAt: Date;
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
  milestones: Array<{
    status: string;
    dueAt: Date | null;
  }>;
  _count: { milestones: number };
}): ProjectSummary {
  const nextMilestoneDueAt = computeNextDueAt(project.milestones);
  const milestonesReleasedCount = project.milestones.filter(
    (m) => m.status === "RELEASED",
  ).length;
  return {
    id: project.id,
    status: project.status,
    title: project.title,
    chainId: project.chainId,
    escrowContractAddress: project.escrowContractAddress,
    onChainProjectId: project.onChainProjectId,
    paymentTokenAddress: project.paymentTokenAddress,
    totalValueWei: project.totalValueWei,
    client: toUserPublicRef(project.client),
    freelancer: project.freelancer ? toUserPublicRef(project.freelancer) : null,
    agreementIpfsUri: project.agreementIpfsUri,
    milestoneCount: project._count.milestones,
    milestonesReleasedCount,
    nextMilestoneDueAt: nextMilestoneDueAt?.toISOString() ?? null,
    openDisputeCount: 0,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function computeNextDueAt(
  milestones: Array<{ dueAt: Date | null }>,
): Date | null {
  const dueDates = milestones
    .map((m) => m.dueAt)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime());
  return dueDates[0] ?? null;
}

function compareWei(
  left: string | null,
  right: string | null,
  order: "asc" | "desc",
): number {
  const l = left ? BigInt(left) : 0n;
  const r = right ? BigInt(right) : 0n;
  if (l === r) {
    return 0;
  }
  const base = l > r ? 1 : -1;
  return order === "asc" ? base : -base;
}

function compareDeadline(
  left: Date | null,
  right: Date | null,
  order: "asc" | "desc",
): number {
  const l = left?.getTime() ?? Number.POSITIVE_INFINITY;
  const r = right?.getTime() ?? Number.POSITIVE_INFINITY;
  if (l === r) {
    return 0;
  }
  const base = l > r ? 1 : -1;
  return order === "asc" ? base : -base;
}

function mapSubmissionPreview(submission: {
  id: string;
  milestoneId: string;
  status: string;
  summary: string | null;
  deliverablesIpfsUri: string;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
}, metadata?: {
  note?: string | null;
  reviewNote?: string | null;
  externalLink?: string | null;
  metadataIpfsUri?: string | null;
  deliverableFiles?: Array<{
    cid: string;
    uri: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}): ProjectSubmissionPreview {
  return {
    id: submission.id,
    milestoneId: submission.milestoneId,
    status: submission.status,
    summary: submission.summary,
    note: metadata?.note ?? submission.summary,
    reviewNote: metadata?.reviewNote ?? null,
    metadataIpfsUri: metadata?.metadataIpfsUri ?? submission.deliverablesIpfsUri,
    externalLink: metadata?.externalLink ?? null,
    deliverableFiles: metadata?.deliverableFiles,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    decidedAt: submission.decidedAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString(),
  };
}

function mapDisputePreview(dispute: {
  id: string;
  milestoneId: string;
  status: DisputeStatus;
  title: string | null;
  description: string;
  evidenceIpfsUri: string;
  createdAt: Date;
  resolvedAt: Date | null;
}): ProjectDisputePreview {
  return {
    id: dispute.id,
    milestoneId: dispute.milestoneId,
    status: dispute.status,
    title: dispute.title,
    description: dispute.description,
    evidenceIpfsUri: dispute.evidenceIpfsUri,
    createdAt: dispute.createdAt.toISOString(),
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
  };
}

function mapProjectTransactionHistory(tx: {
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  eventName: string;
  fromAddress: string | null;
  toAddress: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): ProjectTransactionHistoryItem {
  const payloadObject = tx.payload && typeof tx.payload === "object" ? tx.payload : null;
  const blockTimestamp =
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
    txHash: tx.txHash,
    blockNumber: tx.blockNumber.toString(),
    logIndex: tx.logIndex,
    eventName: tx.eventName,
    fromAddress: tx.fromAddress,
    toAddress: tx.toAddress,
    amountWei: typeof amountRaw === "string" ? amountRaw : null,
    createdAt: tx.createdAt.toISOString(),
    blockTimestamp: typeof blockTimestamp === "string" ? blockTimestamp : null,
  };
}

async function mapLatestSubmissionWithMetadata(submission: {
  id: string;
  milestoneId: string;
  status: string;
  summary: string | null;
  deliverablesIpfsUri: string;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
}): Promise<ProjectSubmissionPreview> {
  const logs = await prisma.transactionLog.findMany({
    where: {
      milestoneId: submission.milestoneId,
      eventName: { in: ["MilestoneSubmissionCreated", "MilestoneApproved"] },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { payload: true, eventName: true },
  });

  const submissionEvent = logs.find((log) => {
    if (log.eventName !== "MilestoneSubmissionCreated") {
      return false;
    }
    const payload =
      log.payload && typeof log.payload === "object"
        ? (log.payload as Record<string, unknown>)
        : null;
    return payload?.submissionId === submission.id;
  });

  const reviewEvent = logs.find((log) => {
    if (log.eventName !== "MilestoneApproved") {
      return false;
    }
    const payload =
      log.payload && typeof log.payload === "object"
        ? (log.payload as Record<string, unknown>)
        : null;
    return payload?.submissionId === submission.id;
  });

  const submissionPayload =
    submissionEvent?.payload && typeof submissionEvent.payload === "object"
      ? (submissionEvent.payload as Record<string, unknown>)
      : {};
  const reviewPayload =
    reviewEvent?.payload && typeof reviewEvent.payload === "object"
      ? (reviewEvent.payload as Record<string, unknown>)
      : {};

  const deliverableFilesRaw = Array.isArray(submissionPayload.deliverableFiles)
    ? submissionPayload.deliverableFiles
    : [];
  const deliverableFiles = deliverableFilesRaw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      cid: String(item.cid ?? ""),
      uri: String(item.uri ?? ""),
      fileName: String(item.fileName ?? "file"),
      mimeType: String(item.mimeType ?? "application/octet-stream"),
      sizeBytes: Number(item.sizeBytes ?? 0),
    }))
    .filter((item) => item.cid && item.uri);

  return mapSubmissionPreview(submission, {
    note: typeof submissionPayload.note === "string" ? submissionPayload.note : null,
    reviewNote: typeof reviewPayload.reviewNote === "string" ? reviewPayload.reviewNote : null,
    externalLink:
      typeof submissionPayload.externalLink === "string"
        ? submissionPayload.externalLink
        : null,
    metadataIpfsUri:
      typeof submissionPayload.metadataIpfsUri === "string"
        ? submissionPayload.metadataIpfsUri
        : submission.deliverablesIpfsUri,
    deliverableFiles,
  });
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
