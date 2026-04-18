import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { buildPublicMarketplaceListWhere } from "@/server/services/marketplace-project-policy";
import { listPublicMarketplaceProjects } from "@/server/services/project-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("listPublicMarketplaceProjects", () => {
  it("queries only OPEN, PUBLIC, unassigned projects", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([]);

    await listPublicMarketplaceProjects({
      query: undefined,
      sortBy: "updatedAt",
      sortOrder: "desc",
      limit: 24,
      cursor: undefined,
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: buildPublicMarketplaceListWhere(undefined),
      }),
    );
  });

  it("adds OR search when query is set", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([]);

    await listPublicMarketplaceProjects({
      query: "api",
      sortBy: "updatedAt",
      sortOrder: "desc",
      limit: 10,
      cursor: undefined,
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: buildPublicMarketplaceListWhere("api"),
      }),
    );
  });
});
