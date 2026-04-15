import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/dashboard-service", () => ({
  buildClientDashboard: vi.fn(),
  buildFreelancerDashboard: vi.fn(),
}));

import { handleGetClientDashboard } from "@/server/route-handlers/v1/dashboard/client";
import { handleGetFreelancerDashboard } from "@/server/route-handlers/v1/dashboard/freelancer";
import { requireAuthenticated } from "@/server/guards/auth-guard";
import {
  buildClientDashboard,
  buildFreelancerDashboard,
} from "@/server/services/dashboard-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("dashboard route handlers", () => {
  it("returns client dashboard for client role", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client-1",
      session: {
        id: "client-1",
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });
    vi.mocked(buildClientDashboard).mockResolvedValue({
      role: "CLIENT",
      summary: {
        activeProjectsCount: 1,
        pendingActionsCount: 1,
        unreadNotificationsCount: 0,
        awaitingEscrowCount: 1,
        totalTrackedProjectCount: 2,
      },
      activeProjects: [],
      awaitingFreelancer: [],
      awaitingEscrow: [],
      actions: [],
      recentTransactions: [],
      notifications: [],
    });

    const response = await handleGetClientDashboard(
      new Request("http://localhost/api/v1/dashboard/client"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      dashboard: { role: string; summary: { activeProjectsCount: number } };
    };
    expect(body.dashboard.role).toBe("CLIENT");
    expect(body.dashboard.summary.activeProjectsCount).toBe(1);
    expect(buildClientDashboard).toHaveBeenCalledWith("client-1");
  });

  it("returns 403 for freelancer requesting client dashboard", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer-1",
      session: {
        id: "freelancer-1",
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        roles: ["FREELANCER"],
        profile: null,
        lastLoginAt: null,
      },
    });

    const response = await handleGetClientDashboard(
      new Request("http://localhost/api/v1/dashboard/client"),
    );
    expect(response.status).toBe(403);
    expect(buildClientDashboard).not.toHaveBeenCalled();
  });

  it("returns freelancer dashboard for freelancer role", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer-1",
      session: {
        id: "freelancer-1",
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        roles: ["FREELANCER"],
        profile: null,
        lastLoginAt: null,
      },
    });
    vi.mocked(buildFreelancerDashboard).mockResolvedValue({
      role: "FREELANCER",
      summary: {
        activeProjectsCount: 2,
        pendingActionsCount: 2,
        unreadNotificationsCount: 1,
        milestonesToDeliverCount: 1,
        underReviewMilestonesCount: 1,
      },
      activeProjects: [],
      milestonesToDeliver: [],
      actions: [],
      recentTransactions: [],
      notifications: [],
    });

    const response = await handleGetFreelancerDashboard(
      new Request("http://localhost/api/v1/dashboard/freelancer"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      dashboard: { role: string; summary: { activeProjectsCount: number } };
    };
    expect(body.dashboard.role).toBe("FREELANCER");
    expect(body.dashboard.summary.activeProjectsCount).toBe(2);
    expect(buildFreelancerDashboard).toHaveBeenCalledWith("freelancer-1");
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const response = await handleGetFreelancerDashboard(
      new Request("http://localhost/api/v1/dashboard/freelancer"),
    );
    expect(response.status).toBe(401);
    expect(buildFreelancerDashboard).not.toHaveBeenCalled();
  });
});
