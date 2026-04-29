// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import MilestoneSubmissionPage from "@/app/projects/[projectId]/milestones/[milestoneId]/submit/page";
import { renderWithProviders } from "@/test/render-with-providers";

const replaceMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  useParams: () => ({ projectId: "project_1", milestoneId: "milestone_1" }),
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
      id: "freelancer_1",
      displayName: "Freelancer",
      walletAddress: "0x1111111111111111111111111111111111111111",
      roles: ["FREELANCER"],
      profile: null,
      lastLoginAt: null,
    },
    isPending: false,
    isFetched: true,
  }),
}));

vi.mock("@/hooks/use-project-detail-query", () => ({
  useProjectDetailQuery: () => ({
    data: {
      id: "project_1",
      title: "Project One",
      status: "ACTIVE",
      freelancer: { id: "freelancer_1" },
      chainId: null,
      onChainProjectId: null,
      escrowContractAddress: null,
      milestones: [
        {
          id: "milestone_1",
          title: "Milestone A",
          status: "FUNDED",
          sortOrder: 0,
          openDisputeId: null,
        },
      ],
    },
    isPending: false,
  }),
}));

vi.mock("wagmi", async () => {
  const actual = await vi.importActual<typeof import("wagmi")>("wagmi");
  return {
    ...actual,
    usePublicClient: () => null,
    useWalletClient: () => ({ data: null }),
    useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
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

describe("MilestoneSubmissionPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows an error if submit is clicked without files", async () => {
    renderWithProviders(createElement(MilestoneSubmissionPage), { includePauseProvider: true });
    fireEvent.click(screen.getByRole("button", { name: "Submit milestone work" }));
    expect(
      await screen.findByText("Please select at least one deliverable file."),
    ).toBeInTheDocument();
  });
});
