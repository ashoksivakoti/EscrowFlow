// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { DisputeCreatePanel } from "@/components/projects/dispute-create-panel";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x2222222222222222222222222222222222222222" }),
  useChainId: () => 421614,
  usePublicClient: () => ({ waitForTransactionReceipt: vi.fn().mockResolvedValue({}) }),
  useWalletClient: () => ({
    data: {
      writeContract: vi.fn().mockResolvedValue("0x" + "1".repeat(64)),
      chain: { id: 421614 },
      account: { address: "0x2222222222222222222222222222222222222222" },
    },
  }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient();
  return render(createElement(QueryClientProvider, { client: queryClient }, node));
}

describe("DisputeCreatePanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows validation error when reason is too short", async () => {
    renderWithQueryClient(
      createElement(DisputeCreatePanel, {
        projectId: "project_1",
        milestoneId: "milestone_1",
        chainId: 421614,
        escrowContractAddress: "0xe5AF7E2CF6435de6B0a0520518FCaaab851BB40c",
        onChainProjectId: "1",
        milestoneIndex: 0,
        milestoneDueAt: "2024-01-01T00:00:00.000Z",
        milestoneStatus: "SUBMITTED",
        projectStatus: "ACTIVE",
        milestoneOpenDisputeId: null,
        milestones: [{ sortOrder: 0, status: "SUBMITTED" }],
        clientWalletAddress: "0x2222222222222222222222222222222222222222",
        freelancerWalletAddress: "0x3333333333333333333333333333333333333333",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));

    expect(
      await screen.findByText("Please provide at least 10 characters in dispute reason."),
    ).toBeInTheDocument();
  });

  it("submits dispute and shows success state", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    renderWithQueryClient(
      createElement(DisputeCreatePanel, {
        projectId: "project_1",
        milestoneId: "milestone_1",
        chainId: 421614,
        escrowContractAddress: "0xe5AF7E2CF6435de6B0a0520518FCaaab851BB40c",
        onChainProjectId: "1",
        milestoneIndex: 0,
        milestoneDueAt: "2024-01-01T00:00:00.000Z",
        milestoneStatus: "SUBMITTED",
        projectStatus: "ACTIVE",
        milestoneOpenDisputeId: null,
        milestones: [{ sortOrder: 0, status: "SUBMITTED" }],
        clientWalletAddress: "0x2222222222222222222222222222222222222222",
        freelancerWalletAddress: "0x3333333333333333333333333333333333333333",
      }),
    );

    fireEvent.change(
      screen.getByPlaceholderText("Describe why this milestone requires dispute review"),
      {
      target: { value: "Client says delivery does not match acceptance criteria." },
      },
    );
    const file = new File(["evidence"], "evidence.txt", { type: "text/plain" });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    expect(await screen.findByText(/Dispute confirmed on-chain/)).toBeInTheDocument();
  });
});
