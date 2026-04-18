// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import MilestoneSubmissionPage from "@/app/projects/[projectId]/milestones/[milestoneId]/submit/page";

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
      freelancer: { id: "freelancer_1" },
      milestones: [{ id: "milestone_1", title: "Milestone A", status: "FUNDED" }],
    },
    isPending: false,
  }),
}));

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient();
  return render(createElement(QueryClientProvider, { client: queryClient }, node));
}

describe("MilestoneSubmissionPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows an error if submit is clicked without files", async () => {
    renderWithQueryClient(createElement(MilestoneSubmissionPage));
    fireEvent.click(screen.getByRole("button", { name: "Submit milestone work" }));
    expect(
      await screen.findByText("Please select at least one deliverable file."),
    ).toBeInTheDocument();
  });
});
