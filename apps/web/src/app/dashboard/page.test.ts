// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import DashboardPage from "@/app/dashboard/page";
import { renderWithProviders } from "@/test/render-with-providers";

const replaceMock = vi.fn();
const pushMock = vi.fn();

const dashboardPageTest = vi.hoisted(() => {
  const state = { roles: ["CLIENT"] as string[] };

  const clientDashboard = {
    summary: {
      activeProjectsCount: 3,
      pendingActionsCount: 0,
      unreadNotificationsCount: 0,
      awaitingEscrowCount: 0,
      totalTrackedProjectCount: 3,
      totalEscrowLockedWei: "1000",
      pendingMilestoneReviewsCount: 2,
      openDisputesCount: 1,
      completedProjectsCount: 4,
    },
    recentProjects: [],
    actions: [],
    recentTransactions: [],
    notifications: [],
  };

  const freelancerDashboard = {
    role: "FREELANCER" as const,
    summary: {
      activeProjectsCount: 2,
      pendingActionsCount: 0,
      unreadNotificationsCount: 0,
      milestonesToDeliverCount: 0,
      underReviewMilestonesCount: 0,
      pendingSubmissionsCount: 1,
      pendingReviewsCount: 0,
      openDisputesCount: 0,
      releasedEarningsWei: "0",
    },
    activeProjects: [],
    milestonesToDeliver: [],
    actions: [],
    recentTransactions: [],
    notifications: [],
  };

  return {
    getRoles: () => state.roles,
    setRoles: (next: string[]) => {
      state.roles = [...next];
    },
    resetRoles: () => {
      state.roles = ["CLIENT"];
    },
    clientDashboard,
    freelancerDashboard,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

vi.mock("@/components/layout/auth-shell", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

vi.mock("@/hooks/use-session-query", () => ({
  useSessionQuery: () => ({
    data: { authenticated: true },
    isPending: false,
  }),
}));

vi.mock("@/hooks/use-me-query", () => ({
  useMeQuery: () => ({
    data: {
      id: "user_1",
      displayName: "Test User",
      walletAddress: "0x2222222222222222222222222222222222222222",
      roles: [...dashboardPageTest.getRoles()],
      profile: null,
      lastLoginAt: null,
    },
    isPending: false,
    isFetched: true,
  }),
}));

vi.mock("@/hooks/use-client-dashboard-query", () => ({
  useClientDashboardQuery: (enabled: boolean) => ({
    data: enabled ? dashboardPageTest.clientDashboard : null,
    isPending: false,
  }),
}));

vi.mock("@/hooks/use-freelancer-dashboard-query", () => ({
  useFreelancerDashboardQuery: (enabled: boolean) => ({
    data: enabled ? dashboardPageTest.freelancerDashboard : null,
    isPending: false,
  }),
}));

vi.mock("wagmi", async () => {
  const actual = await vi.importActual<typeof import("wagmi")>("wagmi");
  return {
    ...actual,
    usePublicClient: () => null,
  };
});

vi.mock("@/lib/contracts/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contracts/roles")>(
    "@/lib/contracts/roles",
  );
  return {
    ...actual,
    useContractRoles: () => ({
      isContractAdmin: false,
      isPauser: false,
      isArbitrator: false,
      isLoading: false,
      error: null,
      warnings: [],
    }),
  };
});

describe("DashboardPage summaries", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    dashboardPageTest.resetRoles();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dashboardPageTest.resetRoles();
  });

  it("renders client summary cards from dashboard payload", async () => {
    renderWithProviders(createElement(DashboardPage), { includePauseProvider: true });

    expect(await screen.findByText("Active projects")).toBeInTheDocument();
    expect(screen.getByText("Pending milestone reviews")).toBeInTheDocument();
    expect(screen.getByText("Open disputes")).toBeInTheDocument();
    expect(screen.getByText("Completed projects")).toBeInTheDocument();
  });

  it("renders freelancer summary cards when user is freelancer-only", async () => {
    dashboardPageTest.setRoles(["FREELANCER"]);
    renderWithProviders(createElement(DashboardPage), { includePauseProvider: true });

    expect(
      screen.queryByText("Dashboard is not available for this role"),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("Active contracts")).toBeInTheDocument();
    expect(screen.getByText("Pending submissions")).toBeInTheDocument();
    expect(screen.getAllByText("Released earnings").length).toBeGreaterThan(0);
  });

  it("renders admin content in shared dashboard layout", async () => {
    dashboardPageTest.setRoles(["ADMIN"]);
    renderWithProviders(createElement(DashboardPage), { includePauseProvider: true });

    expect(await screen.findByText("Admin operations")).toBeInTheDocument();
    expect(screen.getByText("Dispute lane")).toBeInTheDocument();
    expect(screen.getByText("Review active disputes")).toBeInTheDocument();
  });
});
