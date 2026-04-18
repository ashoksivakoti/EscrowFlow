import type { Prisma } from "@prisma/client";
import { ProjectApplicationStatus, ProjectStatus, ProjectVisibility } from "@prisma/client";

import { AppError } from "@/server/errors/app-error";

/** Fields required to decide if a project is shown on the public marketplace. */
export type MarketplaceListingSnapshot = {
  status: ProjectStatus;
  visibility: ProjectVisibility;
  freelancerUserId: string | null;
};

export const marketplaceListingPrismaWhere = {
  status: ProjectStatus.OPEN,
  visibility: ProjectVisibility.PUBLIC,
  freelancerUserId: null,
} as const satisfies Pick<Prisma.ProjectWhereInput, "status" | "visibility" | "freelancerUserId">;

export function isPublicMarketplaceListing(row: MarketplaceListingSnapshot): boolean {
  return (
    row.status === marketplaceListingPrismaWhere.status &&
    row.visibility === marketplaceListingPrismaWhere.visibility &&
    row.freelancerUserId === marketplaceListingPrismaWhere.freelancerUserId
  );
}

export function buildPublicMarketplaceListWhere(searchQuery?: string): Prisma.ProjectWhereInput {
  return {
    ...marketplaceListingPrismaWhere,
    ...(searchQuery
      ? {
          OR: [
            { title: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

/**
 * Public read: hide non-listable projects (404), do not distinguish private vs missing.
 * Returns the same row reference for ergonomic chaining while preserving Prisma result typing.
 */
export function ensurePublicMarketplaceProjectRow<T extends MarketplaceListingSnapshot>(
  project: T | null,
): T {
  if (!project || !isPublicMarketplaceListing(project)) {
    throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  return project;
}

/**
 * Apply flow: unknown id → 404; known but not recruiting → 409.
 */
export function ensureProjectOpenForFreelancerApplications<
  T extends MarketplaceListingSnapshot & { id: string },
>(project: T | null): T {
  if (!project) {
    throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  if (!isPublicMarketplaceListing(project)) {
    throw AppError.conflict(
      "PROJECT_NOT_OPEN_FOR_APPLICATIONS",
      "This project is not accepting applications",
    );
  }
  return project;
}

export function assertProjectClient<T extends { clientUserId: string }>(
  project: T | null,
  clientUserId: string,
  forbiddenMessage: string,
): T {
  if (!project) {
    throw AppError.notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  if (project.clientUserId !== clientUserId) {
    throw AppError.forbidden(forbiddenMessage);
  }
  return project;
}

type PendingApplicationRow = { id: string; status: ProjectApplicationStatus };

export function requirePendingProjectApplication<T extends PendingApplicationRow>(
  application: T | null,
  messages: { notFound: string; notPending: string },
): T {
  if (!application) {
    throw AppError.notFound("APPLICATION_NOT_FOUND", messages.notFound);
  }
  if (application.status !== ProjectApplicationStatus.PENDING) {
    throw AppError.conflict("APPLICATION_NOT_PENDING", messages.notPending);
  }
  return application;
}
