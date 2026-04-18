import { describe, expect, it } from "vitest";

import { ProjectStatus, ProjectVisibility } from "@prisma/client";

import {
  buildPublicMarketplaceListWhere,
  ensureProjectOpenForFreelancerApplications,
  ensurePublicMarketplaceProjectRow,
  isPublicMarketplaceListing,
} from "@/server/services/marketplace-project-policy";

describe("isPublicMarketplaceListing", () => {
  const listed = {
    status: ProjectStatus.OPEN,
    visibility: ProjectVisibility.PUBLIC,
    freelancerUserId: null as string | null,
  };

  it("is true only for OPEN + PUBLIC + unassigned", () => {
    expect(isPublicMarketplaceListing(listed)).toBe(true);
  });

  it("is false after client accepts (AWAITING_ESCROW + freelancer)", () => {
    expect(
      isPublicMarketplaceListing({
        status: ProjectStatus.AWAITING_ESCROW,
        visibility: ProjectVisibility.PUBLIC,
        freelancerUserId: "freelancer_1",
      }),
    ).toBe(false);
  });

  it("is false when still OPEN but freelancer slot is filled", () => {
    expect(
      isPublicMarketplaceListing({
        ...listed,
        freelancerUserId: "someone",
      }),
    ).toBe(false);
  });

  it("is false for PRIVATE OPEN unassigned", () => {
    expect(
      isPublicMarketplaceListing({
        ...listed,
        visibility: ProjectVisibility.PRIVATE,
      }),
    ).toBe(false);
  });
});

describe("ensurePublicMarketplaceProjectRow", () => {
  it("throws PROJECT_NOT_FOUND when not listable (e.g. after assignment)", () => {
    let caught: unknown;
    try {
      ensurePublicMarketplaceProjectRow({
        status: ProjectStatus.AWAITING_ESCROW,
        visibility: ProjectVisibility.PUBLIC,
        freelancerUserId: "fl",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: "PROJECT_NOT_FOUND", status: 404 });
  });
});

describe("ensureProjectOpenForFreelancerApplications", () => {
  it("throws 404 when project is null", () => {
    expect(() => ensureProjectOpenForFreelancerApplications(null)).toThrow(
      expect.objectContaining({ code: "PROJECT_NOT_FOUND", status: 404 }),
    );
  });

  it("throws 409 when project is no longer listable (assigned)", () => {
    expect(() =>
      ensureProjectOpenForFreelancerApplications({
        id: "p1",
        status: ProjectStatus.AWAITING_ESCROW,
        visibility: ProjectVisibility.PUBLIC,
        freelancerUserId: "fl",
      }),
    ).toThrow(expect.objectContaining({ code: "PROJECT_NOT_OPEN_FOR_APPLICATIONS", status: 409 }));
  });
});

describe("buildPublicMarketplaceListWhere", () => {
  it("matches OPEN + PUBLIC + null freelancer base filter", () => {
    const where = buildPublicMarketplaceListWhere(undefined);
    expect(where).toMatchObject({
      status: ProjectStatus.OPEN,
      visibility: ProjectVisibility.PUBLIC,
      freelancerUserId: null,
    });
  });
});
