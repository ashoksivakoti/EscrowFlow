import { PlatformRole, Prisma, ProjectApplicationStatus, ProjectStatus } from "@prisma/client";

import type {
  CreateProjectApplicationRequest,
  CreateProjectApplicationResponse,
  ListProjectApplicationsResponse,
  ProjectApplicationDto,
} from "@escrowflow/types";

import { prisma, prismaInteractiveTransactionOptions } from "@/lib/prisma";
import { toUserPublicRef } from "@/server/mappers/user-public-ref";
import { AppError } from "@/server/errors/app-error";
import {
  notifyProjectApplicationAccepted,
  notifyProjectApplicationReceived,
  notifyProjectApplicationsDeclined,
} from "@/server/services/notification-events";
import {
  assertProjectClient,
  ensureProjectOpenForFreelancerApplications,
  isPublicMarketplaceListing,
  requirePendingProjectApplication,
} from "@/server/services/marketplace-project-policy";

function applicantNotificationLabel(freelancer: {
  walletAddress: string;
  profile: { displayName: string } | null;
}): string {
  const name = freelancer.profile?.displayName?.trim();
  if (name) {
    return name;
  }
  const addr = freelancer.walletAddress;
  if (addr.length >= 12) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }
  return addr;
}

function mapApplication(row: {
  id: string;
  projectId: string;
  coverLetter: string;
  portfolioLink: string | null;
  proposedTimeline: string | null;
  status: ProjectApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
  freelancer: {
    id: string;
    walletAddress: string;
    profile: { displayName: string; avatarUrl: string | null } | null;
  };
}): ProjectApplicationDto {
  return {
    id: row.id,
    projectId: row.projectId,
    freelancer: toUserPublicRef(row.freelancer),
    coverLetter: row.coverLetter,
    portfolioLink: row.portfolioLink,
    proposedTimeline: row.proposedTimeline,
    status: row.status as ProjectApplicationDto["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Defense in depth: route layer also enforces FREELANCER. */
async function assertAccountHasFreelancerRole(userId: string): Promise<void> {
  const roles = await prisma.userPlatformRole.findMany({
    where: { userId, role: PlatformRole.FREELANCER },
    take: 1,
  });
  if (roles.length === 0) {
    throw AppError.forbidden("Only freelancers can apply to marketplace projects");
  }
}

export async function applyToProject(
  projectId: string,
  freelancerUserId: string,
  body: CreateProjectApplicationRequest,
): Promise<CreateProjectApplicationResponse> {
  await assertAccountHasFreelancerRole(freelancerUserId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      clientUserId: true,
      status: true,
      visibility: true,
      freelancerUserId: true,
    },
  });

  const openListing = ensureProjectOpenForFreelancerApplications(project);

  if (openListing.clientUserId === freelancerUserId) {
    throw AppError.badRequest("INVALID_APPLICANT", "Project owner cannot apply");
  }

  try {
    const created = await prisma.projectApplication.create({
      data: {
        projectId,
        freelancerUserId,
        coverLetter: body.coverLetter,
        portfolioLink: body.portfolioLink ?? null,
        proposedTimeline: body.proposedTimeline ?? null,
        status: ProjectApplicationStatus.PENDING,
      },
      include: {
        freelancer: { include: { profile: true } },
      },
    });
    await notifyProjectApplicationReceived({
      projectId: openListing.id,
      projectTitle: openListing.title,
      clientUserId: openListing.clientUserId,
      applicantLabel: applicantNotificationLabel(created.freelancer),
    });
    return { application: mapApplication(created) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw AppError.conflict(
        "APPLICATION_ALREADY_EXISTS",
        "You have already applied to this project",
      );
    }
    throw error;
  }
}

export async function listProjectApplicationsForClient(
  projectId: string,
  clientUserId: string,
): Promise<ListProjectApplicationsResponse> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { clientUserId: true },
  });
  assertProjectClient(project, clientUserId, "Only the project client can view applications");

  const rows = await prisma.projectApplication.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      freelancer: { include: { profile: true } },
    },
  });

  return { applications: rows.map(mapApplication) };
}

export async function acceptProjectApplication(
  projectId: string,
  applicationId: string,
  clientUserId: string,
): Promise<void> {
  type AcceptanceNotice = { projectTitle: string; freelancerUserId: string };
  type DeclinedNotice = { projectTitle: string; freelancerUserIds: string[] };

  const { acceptanceNotice, declinedOtherApplicants } = await prisma.$transaction(
    async (tx): Promise<{
      acceptanceNotice: AcceptanceNotice;
      declinedOtherApplicants: DeclinedNotice | null;
    }> => {
      const projectRow = await tx.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          title: true,
          clientUserId: true,
          status: true,
          visibility: true,
          freelancerUserId: true,
        },
      });
      const project = assertProjectClient(
        projectRow,
        clientUserId,
        "Only the project client can accept applications",
      );

      if (!isPublicMarketplaceListing(project)) {
        throw AppError.conflict(
          "PROJECT_NOT_OPEN_FOR_APPLICATIONS",
          "This project is no longer accepting applications",
        );
      }

      const applicationRow = await tx.projectApplication.findFirst({
        where: { id: applicationId, projectId },
        select: { id: true, status: true, freelancerUserId: true },
      });
      const pending = requirePendingProjectApplication(applicationRow, {
        notFound: "Application not found",
        notPending: "Only pending applications can be accepted",
      });

      await tx.projectApplication.update({
        where: { id: pending.id },
        data: { status: ProjectApplicationStatus.ACCEPTED },
      });

      const otherPendingRows = await tx.projectApplication.findMany({
        where: {
          projectId,
          id: { not: pending.id },
          status: ProjectApplicationStatus.PENDING,
        },
        select: { freelancerUserId: true },
      });

      await tx.projectApplication.updateMany({
        where: {
          projectId,
          id: { not: pending.id },
          status: ProjectApplicationStatus.PENDING,
        },
        data: { status: ProjectApplicationStatus.DECLINED },
      });

      await tx.project.update({
        where: { id: projectId },
        data: {
          freelancerUserId: pending.freelancerUserId,
          status: ProjectStatus.AWAITING_ESCROW,
        },
      });

      const acceptanceNotice: AcceptanceNotice = {
        projectTitle: project.title,
        freelancerUserId: pending.freelancerUserId,
      };

      const otherFreelancerIds = otherPendingRows.map((row) => row.freelancerUserId);
      const declinedOtherApplicants: DeclinedNotice | null =
        otherFreelancerIds.length > 0
          ? { projectTitle: project.title, freelancerUserIds: otherFreelancerIds }
          : null;

      return { acceptanceNotice, declinedOtherApplicants };
    },
    prismaInteractiveTransactionOptions,
  );

  await notifyProjectApplicationAccepted({
    projectId,
    projectTitle: acceptanceNotice.projectTitle,
    freelancerUserId: acceptanceNotice.freelancerUserId,
  });
  if (declinedOtherApplicants?.freelancerUserIds.length) {
    await notifyProjectApplicationsDeclined({
      projectId,
      projectTitle: declinedOtherApplicants.projectTitle,
      freelancerUserIds: declinedOtherApplicants.freelancerUserIds,
      reason: "OTHER_CANDIDATE_ACCEPTED",
    });
  }
}

export async function declineProjectApplication(
  projectId: string,
  applicationId: string,
  clientUserId: string,
): Promise<void> {
  const projectRow = await prisma.project.findUnique({
    where: { id: projectId },
    select: { clientUserId: true, title: true },
  });
  const project = assertProjectClient(
    projectRow,
    clientUserId,
    "Only the project client can decline applications",
  );

  const applicationRow = await prisma.projectApplication.findFirst({
    where: { id: applicationId, projectId },
    select: { id: true, status: true, freelancerUserId: true },
  });
  const pending = requirePendingProjectApplication(applicationRow, {
    notFound: "Application not found",
    notPending: "Only pending applications can be declined",
  });

  await prisma.projectApplication.update({
    where: { id: pending.id },
    data: { status: ProjectApplicationStatus.DECLINED },
  });

  await notifyProjectApplicationsDeclined({
    projectId,
    projectTitle: project.title,
    freelancerUserIds: [pending.freelancerUserId],
    reason: "CLIENT_DECLINED",
  });
}

export async function withdrawProjectApplication(
  projectId: string,
  applicationId: string,
  freelancerUserId: string,
): Promise<void> {
  const applicationRow = await prisma.projectApplication.findFirst({
    where: { id: applicationId, projectId, freelancerUserId },
    select: { id: true, status: true },
  });
  const pending = requirePendingProjectApplication(applicationRow, {
    notFound: "Application not found",
    notPending: "Only pending applications can be withdrawn",
  });

  await prisma.projectApplication.update({
    where: { id: pending.id },
    data: { status: ProjectApplicationStatus.WITHDRAWN },
  });
}
