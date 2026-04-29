// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

import { DisputeCreatePanel } from "@/components/projects/dispute-create-panel";
import { renderWithProviders } from "@/test/render-with-providers";

const disputeCreatePanelTest = vi.hoisted(() => ({
  readContractImpl: vi.fn(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "getProject":
        return { status: 0 };
      case "getMilestone":
        return { status: 1 };
      case "getDispute":
        return [false];
      case "paused":
        return false;
      default:
        throw new Error(`Unexpected readContract call: ${functionName}`);
    }
  }),
  waitForTransactionReceipt: vi.fn().mockResolvedValue({}),
  getTransactionReceipt: vi.fn().mockResolvedValue({ blockNumber: 123n }),
  writeContract: vi.fn().mockResolvedValue(`0x${"1".repeat(64)}`),
}));

vi.mock("wagmi", async () => {
  const actual = await vi.importActual<typeof import("wagmi")>("wagmi");
  return {
    ...actual,
    useAccount: () => ({ address: "0x2222222222222222222222222222222222222222" }),
    useChainId: () => 421614,
    usePublicClient: () => ({
      readContract: disputeCreatePanelTest.readContractImpl,
      waitForTransactionReceipt: disputeCreatePanelTest.waitForTransactionReceipt,
      getTransactionReceipt: disputeCreatePanelTest.getTransactionReceipt,
    }),
    useWalletClient: () => ({
      data: {
        writeContract: disputeCreatePanelTest.writeContract,
        chain: { id: 421614 },
        account: { address: "0x2222222222222222222222222222222222222222" },
      },
    }),
    useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  };
});

function renderPanel(input?: {
  milestones?: Array<{ sortOrder: number; status: string }>;
  milestoneOpenDisputeId?: string | null;
}) {
  return renderWithProviders(
    createElement(DisputeCreatePanel, {
      projectId: "project_1",
      milestoneId: "milestone_1",
      chainId: 421614,
      escrowContractAddress: "0xe5AF7E2CF6435de6B0a0520518FCaaab851BB40c",
      onChainProjectId: "1",
      milestoneIndex: 1,
      milestoneDueAt: "2024-01-01T00:00:00.000Z",
      milestoneStatus: "SUBMITTED",
      projectStatus: "ACTIVE",
      milestoneOpenDisputeId: input?.milestoneOpenDisputeId ?? null,
      milestones:
        input?.milestones ??
        [
          { sortOrder: 0, status: "RELEASED" },
          { sortOrder: 1, status: "SUBMITTED" },
        ],
      clientWalletAddress: "0x2222222222222222222222222222222222222222",
      freelancerWalletAddress: "0x3333333333333333333333333333333333333333",
    }),
  );
}

describe("DisputeCreatePanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    disputeCreatePanelTest.readContractImpl.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case "getProject":
            return { status: 0 };
          case "getMilestone":
            return { status: 1 };
          case "getDispute":
            return [false];
          case "paused":
            return false;
          default:
            throw new Error(`Unexpected readContract call: ${functionName}`);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows validation error when reason is too short", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));

    expect(
      await screen.findByText("Please provide at least 10 characters in dispute reason."),
    ).toBeInTheDocument();
  });

  it("submits dispute and shows success state", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    renderPanel();

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
    expect(disputeCreatePanelTest.readContractImpl).toHaveBeenCalledTimes(4);
    expect(await screen.findByText(/Dispute confirmed on-chain/)).toBeInTheDocument();
  });

  it("blocks when previous milestone is incomplete", async () => {
    renderPanel({
      milestones: [
        { sortOrder: 0, status: "SUBMITTED" },
        { sortOrder: 1, status: "SUBMITTED" },
      ],
    });
    expect(
      screen.getByText("Complete earlier milestones before raising a dispute on this milestone."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit dispute" })).toBeDisabled();
  });

  it("blocks when dispute is already active", async () => {
    renderPanel({ milestoneOpenDisputeId: "disp_1" });
    expect(screen.getByText("This milestone already has an active dispute.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit dispute" })).toBeDisabled();
  });

  it("shows preflight mismatch when contract is paused", async () => {
    disputeCreatePanelTest.readContractImpl.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "paused") return true;
        if (functionName === "getProject") return { status: 0 };
        if (functionName === "getMilestone") return { status: 1 };
        if (functionName === "getDispute") return [false];
        throw new Error(`Unexpected readContract call: ${functionName}`);
      },
    );
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Describe why this milestone requires dispute review"), {
      target: { value: "Client says delivery does not match acceptance criteria." },
    });
    const file = new File(["evidence"], "evidence.txt", { type: "text/plain" });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));
    expect(await screen.findByText("Dispute preflight failed due to chain/db mismatch.")).toBeInTheDocument();
    const calls = vi.mocked(fetch).mock.calls;
    const hasDisputeCreatePost = calls.some(
      ([url, init]) =>
        typeof url === "string" &&
        url.includes("/api/v1/projects/project_1/milestones/milestone_1/disputes") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(hasDisputeCreatePost).toBe(false);
  });

  it("shows recoverable error when readContract fails", async () => {
    disputeCreatePanelTest.readContractImpl.mockRejectedValue(new Error("rpc down"));
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Describe why this milestone requires dispute review"), {
      target: { value: "Client says delivery does not match acceptance criteria." },
    });
    const file = new File(["evidence"], "evidence.txt", { type: "text/plain" });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));
    expect(await screen.findByText("rpc down")).toBeInTheDocument();
  });
});
