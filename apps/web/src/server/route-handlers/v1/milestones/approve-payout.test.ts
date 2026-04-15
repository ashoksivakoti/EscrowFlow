import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/milestone-review-service", () => ({
  reconcileMilestoneApprovalAndPayout: vi.fn(),
}));

import { handleApproveMilestoneAndPayout } from "@/server/route-handlers/v1/milestones/approve-payout";
import { requireAuthenticated } from "@/server/guards/auth-guard";
import { reconcileMilestoneApprovalAndPayout } from "@/server/services/milestone-review-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleApproveMilestoneAndPayout", () => {
  it("reconciles approval/payout for authenticated client", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client_1",
      session: {
        id: "client_1",
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });
    vi.mocked(reconcileMilestoneApprovalAndPayout).mockResolvedValue({
      projectId: "p1",
      milestoneId: "m1",
      submissionId: "s1",
      releasedAmountWei: "1000000",
      projectReleasedAmountWei: "2000000",
      projectStatus: "ACTIVE",
    });

    const request = new Request(
      "http://localhost/api/v1/projects/p1/milestones/m1/approve-payout",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: "s1",
          reviewNote: "Looks good",
          chainId: 31337,
          escrowContractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
          onChainProjectId: "1",
          milestoneIndex: 0,
          approveTxHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          releaseTxHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          releasedAmountWei: "1000000",
        }),
      },
    );

    const response = await handleApproveMilestoneAndPayout(request, "p1", "m1");
    expect(response.status).toBe(200);
    expect(reconcileMilestoneApprovalAndPayout).toHaveBeenCalledOnce();
  });

  it("returns 403 for non-client role", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer_1",
      session: {
        id: "freelancer_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        roles: ["FREELANCER"],
        profile: null,
        lastLoginAt: null,
      },
    });

    const request = new Request(
      "http://localhost/api/v1/projects/p1/milestones/m1/approve-payout",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: "s1",
          chainId: 31337,
          escrowContractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
          onChainProjectId: "1",
          milestoneIndex: 0,
          approveTxHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          releaseTxHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          releasedAmountWei: "1000000",
        }),
      },
    );

    const response = await handleApproveMilestoneAndPayout(request, "p1", "m1");
    expect(response.status).toBe(403);
    expect(reconcileMilestoneApprovalAndPayout).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const request = new Request(
      "http://localhost/api/v1/projects/p1/milestones/m1/approve-payout",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: "s1",
          chainId: 31337,
          escrowContractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
          onChainProjectId: "1",
          milestoneIndex: 0,
          approveTxHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          releaseTxHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          releasedAmountWei: "1000000",
        }),
      },
    );

    const response = await handleApproveMilestoneAndPayout(request, "p1", "m1");
    expect(response.status).toBe(401);
  });
});
