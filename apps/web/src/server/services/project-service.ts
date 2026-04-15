import { PlatformRole, ProjectStatus } from "@prisma/client";
import { getAddress } from "viem";

import type { CreateProjectBody } from "@/server/validation/schemas/projects";
import type {
  CreateProjectResponse,
  ListProjectsResponse,
  ProjectSummary,
  MilestoneSummary,
  ProjectDetail,
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
  }>;
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
    latestSubmissionId: null,
    openDisputeId: null,
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
    client: toUserPublicRef(project.client),
    freelancer: project.freelancer ? toUserPublicRef(project.freelancer) : null,
    agreementIpfsUri: project.agreementIpfsUri,
    milestoneCount: milestones.length,
    openDisputeCount: 0,
    updatedAt: project.updatedAt.toISOString(),
    milestones,
    completedAt: project.completedAt?.toISOString() ?? null,
    cancelledAt: project.cancelledAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
  };
}

export async function listProjectsForUser(userId: string): Promise<ListProjectsResponse> {
  const rows = await prisma.project.findMany({
    where: {
      OR: [{ clientUserId: userId }, { freelancerUserId: userId }],
    },
    include: {
      client: { include: { profile: true } },
      freelancer: { include: { profile: true } },
      milestones: { orderBy: { sortOrder: "asc" } },
      _count: { select: { milestones: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return {
    items: rows.map((row) => mapProjectSummary(row)),
    nextCursor: null,
    hasMore: false,
  };
}

export async function getProjectDetailForUser(
  projectId: string,
  userId: string,
): Promise<ProjectDetail> {
  const row = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: { include: { profile: true } },
      freelancer: { include: { profile: true } },
      milestones: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!row) {
    throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  if (row.clientUserId !== userId && row.freelancerUserId !== userId) {
    throw AppError.forbidden("You are not a participant in this project");
  }
  return mapProjectDetail(row);
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
  _count: { milestones: number };
}): ProjectSummary {
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
    openDisputeCount: 0,
    updatedAt: project.updatedAt.toISOString(),
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
