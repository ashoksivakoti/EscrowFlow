import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@escrowflow/types";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/project-service", () => ({
  listPublicMarketplaceProjects: vi.fn(),
}));

vi.mock("@/server/services/project-application-service", () => ({
  applyToProject: vi.fn(),
  listProjectApplicationsForClient: vi.fn(),
  acceptProjectApplication: vi.fn(),
  declineProjectApplication: vi.fn(),
  withdrawProjectApplication: vi.fn(),
}));

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleAcceptApplication } from "@/server/route-handlers/v1/projects/application-accept";
import { handleDeclineApplication } from "@/server/route-handlers/v1/projects/application-decline";
import { handleWithdrawApplication } from "@/server/route-handlers/v1/projects/application-withdraw";
import {
  handleCreateProjectApplication,
  handleListProjectApplications,
} from "@/server/route-handlers/v1/projects/project-applications";
import { handleListPublicProjects } from "@/server/route-handlers/v1/projects/public-list";
import {
  acceptProjectApplication,
  applyToProject,
  declineProjectApplication,
  listProjectApplicationsForClient,
  withdrawProjectApplication,
} from "@/server/services/project-application-service";
import { listPublicMarketplaceProjects } from "@/server/services/project-service";

afterEach(() => {
  vi.clearAllMocks();
});

const freelancerSession: SessionUser = {
  id: "freelancer_1",
  walletAddress: "0x2222222222222222222222222222222222222222",
  roles: ["FREELANCER"],
  profile: null,
  lastLoginAt: null,
};

const clientSession: SessionUser = {
  id: "client_1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  roles: ["CLIENT"],
  profile: null,
  lastLoginAt: null,
};

describe("handleListPublicProjects", () => {
  it("lists public marketplace projects with parsed query", async () => {
    vi.mocked(listPublicMarketplaceProjects).mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });

    const response = await handleListPublicProjects(
      new Request(
        "http://localhost/api/v1/projects/public?query=design&sortBy=updatedAt&sortOrder=desc&limit=10",
      ),
    );
    expect(response.status).toBe(200);
    expect(listPublicMarketplaceProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "design",
        sortBy: "updatedAt",
        sortOrder: "desc",
        limit: 10,
      }),
    );
  });
});

describe("handleCreateProjectApplication", () => {
  const validBody = {
    coverLetter: "This is my cover letter with enough characters.",
    portfolioLink: "https://example.com/portfolio",
    proposedTimeline: "",
  };

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const response = await handleCreateProjectApplication(
      new Request("http://localhost/api/v1/projects/p1/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      "p1",
    );
    expect(response.status).toBe(401);
    expect(applyToProject).not.toHaveBeenCalled();
  });

  it("returns 400 when body is not valid JSON", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    const response = await handleCreateProjectApplication(
      new Request("http://localhost/api/v1/projects/p1/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      "p1",
    );
    expect(response.status).toBe(400);
    expect(applyToProject).not.toHaveBeenCalled();
  });

  it("returns 400 when portfolio link is not a valid URL", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    const response = await handleCreateProjectApplication(
      new Request("http://localhost/api/v1/projects/p1/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coverLetter: validBody.coverLetter,
          portfolioLink: "not-a-url",
        }),
      }),
      "p1",
    );
    expect(response.status).toBe(400);
    expect(applyToProject).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not a freelancer", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client_1",
      session: clientSession,
    });
    const response = await handleCreateProjectApplication(
      new Request("http://localhost/api/v1/projects/p1/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      "p1",
    );
    expect(response.status).toBe(403);
    expect(applyToProject).not.toHaveBeenCalled();
  });

  it("returns 400 for short cover letter", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    const response = await handleCreateProjectApplication(
      new Request("http://localhost/api/v1/projects/p1/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coverLetter: "too short",
          portfolioLink: "https://example.com/portfolio",
        }),
      }),
      "p1",
    );
    expect(response.status).toBe(400);
    expect(applyToProject).not.toHaveBeenCalled();
  });

  it("returns 400 when portfolio link is missing", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    const response = await handleCreateProjectApplication(
      new Request("http://localhost/api/v1/projects/p1/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          coverLetter: validBody.coverLetter,
        }),
      }),
      "p1",
    );
    expect(response.status).toBe(400);
    expect(applyToProject).not.toHaveBeenCalled();
  });

  it("creates application for freelancer", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    vi.mocked(applyToProject).mockResolvedValue({
      application: {
        id: "app_1",
        projectId: "p1",
        freelancer: {
          id: "freelancer_1",
          walletAddress: freelancerSession.walletAddress,
          displayName: null,
          avatarUrl: null,
        },
        coverLetter: validBody.coverLetter,
        portfolioLink: validBody.portfolioLink,
        proposedTimeline: null,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const response = await handleCreateProjectApplication(
      new Request("http://localhost/api/v1/projects/p1/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
      "p1",
    );
    expect(response.status).toBe(201);
    expect(applyToProject).toHaveBeenCalledWith(
      "p1",
      "freelancer_1",
      expect.objectContaining({
        coverLetter: validBody.coverLetter,
        portfolioLink: validBody.portfolioLink,
        proposedTimeline: "",
      }),
    );
  });
});

describe("handleListProjectApplications", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const response = await handleListProjectApplications(
      new Request("http://localhost/api/v1/projects/p1/applications"),
      "p1",
    );
    expect(response.status).toBe(401);
    expect(listProjectApplicationsForClient).not.toHaveBeenCalled();
  });

  it("returns 403 for non-client", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    const response = await handleListProjectApplications(
      new Request("http://localhost/api/v1/projects/p1/applications"),
      "p1",
    );
    expect(response.status).toBe(403);
    expect(listProjectApplicationsForClient).not.toHaveBeenCalled();
  });

  it("returns applications for project owner", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client_1",
      session: clientSession,
    });
    vi.mocked(listProjectApplicationsForClient).mockResolvedValue({ applications: [] });

    const response = await handleListProjectApplications(
      new Request("http://localhost/api/v1/projects/p1/applications"),
      "p1",
    );
    expect(response.status).toBe(200);
    expect(listProjectApplicationsForClient).toHaveBeenCalledWith("p1", "client_1");
  });
});

describe("handleAcceptApplication", () => {
  it("returns 403 when authenticated user is not a client", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    const response = await handleAcceptApplication(
      new Request("http://localhost/api/v1/projects/p1/applications/app1/accept", { method: "POST" }),
      "p1",
      "app1",
    );
    expect(response.status).toBe(403);
    expect(acceptProjectApplication).not.toHaveBeenCalled();
  });

  it("accepts when client is authenticated", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client_1",
      session: clientSession,
    });
    vi.mocked(acceptProjectApplication).mockResolvedValue(undefined);

    const response = await handleAcceptApplication(
      new Request("http://localhost/api/v1/projects/p1/applications/app1/accept", { method: "POST" }),
      "p1",
      "app1",
    );
    expect(response.status).toBe(204);
    expect(acceptProjectApplication).toHaveBeenCalledWith("p1", "app1", "client_1");
  });
});

describe("handleDeclineApplication", () => {
  it("returns 403 when authenticated user is not a client", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    const response = await handleDeclineApplication(
      new Request("http://localhost/api/v1/projects/p1/applications/app1/decline", { method: "POST" }),
      "p1",
      "app1",
    );
    expect(response.status).toBe(403);
    expect(declineProjectApplication).not.toHaveBeenCalled();
  });

  it("declines when client is authenticated", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client_1",
      session: clientSession,
    });
    vi.mocked(declineProjectApplication).mockResolvedValue(undefined);

    const response = await handleDeclineApplication(
      new Request("http://localhost/api/v1/projects/p1/applications/app1/decline", { method: "POST" }),
      "p1",
      "app1",
    );
    expect(response.status).toBe(204);
    expect(declineProjectApplication).toHaveBeenCalledWith("p1", "app1", "client_1");
  });
});

describe("handleWithdrawApplication", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const response = await handleWithdrawApplication(
      new Request("http://localhost/api/v1/projects/p1/applications/app1/withdraw", { method: "POST" }),
      "p1",
      "app1",
    );
    expect(response.status).toBe(401);
    expect(withdrawProjectApplication).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not a freelancer", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client_1",
      session: clientSession,
    });
    const response = await handleWithdrawApplication(
      new Request("http://localhost/api/v1/projects/p1/applications/app1/withdraw", { method: "POST" }),
      "p1",
      "app1",
    );
    expect(response.status).toBe(403);
    expect(withdrawProjectApplication).not.toHaveBeenCalled();
  });

  it("returns 204 when freelancer withdraws", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: freelancerSession,
    });
    vi.mocked(withdrawProjectApplication).mockResolvedValue(undefined);

    const response = await handleWithdrawApplication(
      new Request("http://localhost/api/v1/projects/p1/applications/app1/withdraw", { method: "POST" }),
      "p1",
      "app1",
    );
    expect(response.status).toBe(204);
    expect(withdrawProjectApplication).toHaveBeenCalledWith("p1", "app1", "freelancer_1");
  });
});
