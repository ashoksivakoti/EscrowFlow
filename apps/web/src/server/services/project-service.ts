import {
  DisputeStatus,
  PlatformRole,
  Prisma,
  ProjectStatus,
  ProjectVisibility,
  TransactionLogSourceType,
} from "@prisma/client";
import { getAddress } from "viem";

import type {
  CreateProjectBody,
  ListProjectsQuery as ListProjectsInput,
} from "@/server/validation/schemas/projects";
import type { CreateMarketplaceProjectBody } from "@/server/validation/schemas/marketplace";
import type { ListPublicProjectsQuery } from "@/server/validation/schemas/marketplace";
import type {
  CreateProjectResponse,
  CreateMarketplaceProjectResponse,
  ListProjectsResponse,
  ListPublicProjectsResponse,
  GetPublicProjectResponse,
  PublicProjectSummary,
  ProjectApplicationStatus,
  ProjectSummary,
  MilestoneSummary,
  ProjectDetail,
  ProjectDisputePreview,
  ProjectSubmissionPreview,
  ProjectTransactionHistoryItem,
} from "@escrowflow/types";

import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { uploadFileToIpfs, uploadJsonToIpfs } from "@/lib/ipfs";
import { getIpfsEnv } from "@/lib/ipfs/env";
import { getContractRuntimeDefaults } from "@/lib/contracts/defaults";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { toUserPublicRef } from "@/server/mappers/user-public-ref";
import { AppError } from "@/server/errors/app-error";
import { createLogger } from "@/server/logging/logger";
import {
  buildPublicMarketplaceListWhere,
  ensurePublicMarketplaceProjectRow,
} from "@/server/services/marketplace-project-policy";
import { notifyProjectCreated } from "@/server/services/notification-events";

function canUseNonCanonicalEscrowOverride(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.CONTRACTS_ALLOW_NON_CANONICAL_ESCROW_OVERRIDE === "true"
  );
}

function assertCanonicalEscrowRegistry(input: {
  escrowContractAddress: string | null;
  context: string;
}): void {
  if (!input.escrowContractAddress) {
    throw AppError.badRequest(
      "ESCROW_CONTRACT_REQUIRED",
      "Escrow registry address is required for project creation.",
    );
  }
  const canonical = canonicalDeployment.contracts.EscrowFlowRegistry.toLowerCase();
  if (input.escrowContractAddress.toLowerCase() === canonical) {
    return;
  }
  if (canUseNonCanonicalEscrowOverride()) {
    return;
  }
  throw AppError.badRequest(
    "NON_CANONICAL_ESCROW_REGISTRY",
    `Non-canonical escrow registry rejected for ${input.context}. Expected ${canonical}.`,
  );
}

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
  const defaults = getContractRuntimeDefaults();
  const freelancerWallet = normalizeWalletOrThrow(payload.freelancerWalletAddress);
  const paymentTokenAddress = payload.paymentTokenAddress
    ? normalizeWalletOrThrow(payload.paymentTokenAddress)
    : defaults.paymentTokenAddress
      ? normalizeWalletOrThrow(defaults.paymentTokenAddress)
    : null;
  const escrowContractAddress = payload.escrowContractAddress
    ? normalizeWalletOrThrow(payload.escrowContractAddress)
    : defaults.escrowContractAddress
      ? normalizeWalletOrThrow(defaults.escrowContractAddress)
    : null;
  assertCanonicalEscrowRegistry({
    escrowContractAddress,
    context: "project creation",
  });

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
          visibility: ProjectVisibility.PRIVATE,
          title: payload.title,
          description: payload.description ?? null,
          agreementIpfsUri: agreementIpfsUri ?? null,
          chainId: payload.chainId ?? defaults.chainId ?? null,
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

  void notifyProjectCreated({
    projectId: created.id,
    projectTitle: created.title,
    clientUserId,
    freelancerUserId: created.freelancer?.id ?? null,
  }).catch(() => undefined);

  return { project: mapProjectDetail(created) };
}

export async function createMarketplaceProjectForClient(
  clientUserId: string,
  payload: CreateMarketplaceProjectBody,
): Promise<CreateMarketplaceProjectResponse> {
  const defaults = getContractRuntimeDefaults();
  const paymentTokenAddress = payload.paymentTokenAddress
    ? normalizeWalletOrThrow(payload.paymentTokenAddress)
    : defaults.paymentTokenAddress
      ? normalizeWalletOrThrow(defaults.paymentTokenAddress)
      : null;
  const escrowContractAddress = payload.escrowContractAddress
    ? normalizeWalletOrThrow(payload.escrowContractAddress)
    : defaults.escrowContractAddress
      ? normalizeWalletOrThrow(defaults.escrowContractAddress)
      : null;
  assertCanonicalEscrowRegistry({
    escrowContractAddress,
    context: "marketplace project creation",
  });

  const agreementIpfsUri = await maybeUploadAgreement(payload);

  const totalValueWei = payload.milestones
    .reduce((acc, m) => acc + BigInt(m.amountWei), 0n)
    .toString();

  const created = await prisma.$transaction(
    async (tx) => {
      const project = await tx.project.create({
        data: {
          clientUserId,
          freelancerUserId: null,
          status: ProjectStatus.OPEN,
          visibility: ProjectVisibility.PUBLIC,
          title: payload.title,
          description: payload.description ?? null,
          agreementIpfsUri: agreementIpfsUri ?? null,
          chainId: payload.chainId ?? defaults.chainId ?? null,
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

  void notifyProjectCreated({
    projectId: created.id,
    projectTitle: created.title,
    clientUserId,
    freelancerUserId: null,
    marketplaceListing: true,
  }).catch(() => undefined);

  return { project: mapProjectDetail(created) };
}

/**
 * After the client calls `EscrowFlowRegistry.createProject` on-chain, persist the returned
 * project id so funding and milestone actions can target the registry.
 */
export async function confirmOnChainProjectBinding(
  clientUserId: string,
  projectId: string,
  onChainProjectId: string,
): Promise<ProjectDetail> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        clientUserId: true,
        status: true,
        chainId: true,
        escrowContractAddress: true,
        paymentTokenAddress: true,
        totalValueWei: true,
        onChainProjectId: true,
        freelancerUserId: true,
      },
    });

    if (!row) {
      throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
    }
    if (row.clientUserId !== clientUserId) {
      throw AppError.forbidden("Only the project client can link the on-chain escrow");
    }
    if (row.onChainProjectId) {
      throw AppError.conflict(
        "ON_CHAIN_PROJECT_ALREADY_LINKED",
        "This project already has an on-chain project id",
      );
    }
    if (row.status !== ProjectStatus.AWAITING_ESCROW) {
      throw AppError.badRequest(
        "INVALID_PROJECT_STATUS",
        "On-chain escrow can only be linked while the project is awaiting escrow funding",
      );
    }
    if (!row.freelancerUserId) {
      throw AppError.badRequest(
        "FREELANCER_REQUIRED",
        "Assign and accept a freelancer before creating the on-chain escrow project",
      );
    }
    if (!row.chainId || !row.escrowContractAddress || !row.paymentTokenAddress || !row.totalValueWei) {
      throw AppError.badRequest(
        "MISSING_ESCROW_CONTEXT",
        "Chain id, escrow contract, payment token, and milestone totals must be set before linking",
      );
    }
    assertCanonicalEscrowRegistry({
      escrowContractAddress: row.escrowContractAddress,
      context: "on-chain project binding",
    });

    const milestoneCount = await tx.milestone.count({ where: { projectId } });
    if (milestoneCount === 0) {
      throw AppError.badRequest("MILESTONES_REQUIRED", "Add at least one milestone before linking");
    }

    await tx.project.update({
      where: { id: projectId },
      data: { onChainProjectId },
    });
  });

  return getProjectDetailForUser(projectId, clientUserId);
}

type AgreementPayload = { agreement?: CreateProjectBody["agreement"] };

async function maybeUploadAgreement(payload: AgreementPayload): Promise<string | null> {
  if (!payload.agreement) {
    return null;
  }
  const logger = createLogger("project.agreement-upload");
  const ipfsEnv = getIpfsEnv();

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
    if (ipfsEnv.IPFS_ALLOW_AGREEMENT_FALLBACK) {
      logger.warn("Agreement IPFS upload failed; falling back without agreement URI", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
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
  visibility: ProjectVisibility;
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
    visibility: project.visibility,
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

function mapPublicProjectSummary(project: {
  id: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  title: string;
  description: string | null;
  totalValueWei: string | null;
  updatedAt: Date;
  client: {
    id: string;
    walletAddress: string;
    profile: { displayName: string; avatarUrl: string | null } | null;
  };
  _count: { milestones: number };
}): PublicProjectSummary {
  return {
    id: project.id,
    status: project.status,
    visibility: project.visibility,
    title: project.title,
    description: project.description,
    totalValueWei: project.totalValueWei,
    milestoneCount: project._count.milestones,
    client: toUserPublicRef(project.client),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function listPublicMarketplaceProjects(
  query: ListPublicProjectsQuery,
): Promise<ListPublicProjectsResponse> {
  const limit = Math.min(query.limit ?? 24, 100);
  const skip = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;
  const sortBy = query.sortBy ?? "updatedAt";
  const sortOrder = query.sortOrder ?? "desc";

  const where = buildPublicMarketplaceListWhere(query.query);

  const rows = await prisma.project.findMany({
    where,
    take: limit + 1,
    skip,
    orderBy: { [sortBy]: sortOrder },
    include: {
      client: { include: { profile: true } },
      _count: { select: { milestones: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map((row) => mapPublicProjectSummary(row));
  const nextCursor = hasMore ? String(skip + limit) : null;

  return { items, nextCursor, hasMore };
}

export async function getPublicProjectDetail(
  projectId: string,
  viewerUserId?: string | null,
): Promise<GetPublicProjectResponse> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: { include: { profile: true } },
      milestones: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, amountWei: true, dueAt: true },
      },
      _count: { select: { milestones: true } },
    },
  });

  const visible = ensurePublicMarketplaceProjectRow(project);

  let myApplicationStatus: ProjectApplicationStatus | null = null;
  if (viewerUserId) {
    const mine = await prisma.projectApplication.findUnique({
      where: {
        projectId_freelancerUserId: { projectId, freelancerUserId: viewerUserId },
      },
      select: { status: true },
    });
    myApplicationStatus = mine ? (mine.status as ProjectApplicationStatus) : null;
  }

  const summary = mapPublicProjectSummary(visible);
  return {
    project: {
      ...summary,
      milestones: visible.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        amountWei: m.amountWei,
        dueAt: m.dueAt?.toISOString() ?? null,
      })),
    },
    myApplicationStatus,
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
        WHERE tl."projectId" = ${projectId}
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
        WHERE tl."projectId" = ${projectId}
          AND tl."sourceType" = ${TransactionLogSourceType.chain_event}::"TransactionLogSourceType"
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
  visibility: ProjectVisibility;
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
    visibility: project.visibility,
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
  chainId: number;
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  eventName: string;
  sourceType: TransactionLogSourceType;
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
      sourceType: {
        in: [
          TransactionLogSourceType.backend_metadata,
          TransactionLogSourceType.synthetic_client_reconcile,
        ],
      },
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

