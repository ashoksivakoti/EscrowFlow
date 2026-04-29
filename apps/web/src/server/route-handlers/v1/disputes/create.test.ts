import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/dispute-service", () => ({
  createMilestoneDisputeForParticipant: vi.fn(),
}));

import { handleCreateMilestoneDispute } from "@/server/route-handlers/v1/disputes/create";
import { requireAuthenticated } from "@/server/guards/auth-guard";
import { createMilestoneDisputeForParticipant } from "@/server/services/dispute-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleCreateMilestoneDispute", () => {
  it("creates dispute for authenticated participant", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client_1",
      session: {
        id: "client_1",
        walletAddress: "0x2222222222222222222222222222222222222222",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });
    vi.mocked(createMilestoneDisputeForParticipant).mockResolvedValue({
      dispute: {
        id: "dispute_1",
        milestoneId: "m1",
        status: "OPEN",
        title: "Milestone dispute",
        description: "Delivery did not match acceptance criteria",
        evidenceIpfsUri: "ipfs://bafy-dispute",
        openedBy: {
          id: "client_1",
          walletAddress: "0x2222222222222222222222222222222222222222",
          displayName: "Client",
          avatarUrl: null,
        },
        relatedSubmissionId: "submission_1",
        resolvedAt: null,
        resolutionTxHash: null,
        createdAt: new Date().toISOString(),
        resolvedBy: null,
        updatedAt: new Date().toISOString(),
      },
    });

    const request = new Request("http://localhost/api/v1/projects/p1/milestones/m1/disputes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Delivery did not match acceptance criteria",
        reasonUri: "escrowflow://disputes/reason/0xabc",
        chainId: 421614,
        escrowContractAddress: "0xe5af7e2cf6435de6b0a0520518fcaaab851bb40c",
        onChainProjectId: "42",
        milestoneIndex: 1,
        disputeTxHash: `0x${"1".repeat(64)}`,
        files: [{ fileName: "evidence.pdf", mimeType: "application/pdf", fileBase64: "SGVsbG8=" }],
        relatedSubmissionId: "submission_1",
      }),
    });

    const response = await handleCreateMilestoneDispute(request, "p1", "m1");
    expect(response.status).toBe(201);
    expect(createMilestoneDisputeForParticipant).toHaveBeenCalledWith({
      projectId: "p1",
      milestoneId: "m1",
      openedByUserId: "client_1",
      payload: expect.objectContaining({
        reason: "Delivery did not match acceptance criteria",
      }),
    });
  });

  it("returns validation error for invalid payload", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "client_1",
      session: {
        id: "client_1",
        walletAddress: "0x2222222222222222222222222222222222222222",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });

    const request = new Request("http://localhost/api/v1/projects/p1/milestones/m1/disputes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "short",
        reasonUri: "escrowflow://disputes/reason/0xabc",
        chainId: 421614,
        escrowContractAddress: "0xe5af7e2cf6435de6b0a0520518fcaaab851bb40c",
        onChainProjectId: "42",
        milestoneIndex: 1,
        disputeTxHash: `0x${"1".repeat(64)}`,
        files: [],
      }),
    });

    const response = await handleCreateMilestoneDispute(request, "p1", "m1");
    expect(response.status).toBe(400);
    expect(createMilestoneDisputeForParticipant).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());

    const request = new Request("http://localhost/api/v1/projects/p1/milestones/m1/disputes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Delivery did not match acceptance criteria",
        reasonUri: "escrowflow://disputes/reason/0xabc",
        chainId: 421614,
        escrowContractAddress: "0xe5af7e2cf6435de6b0a0520518fcaaab851bb40c",
        onChainProjectId: "42",
        milestoneIndex: 1,
        disputeTxHash: `0x${"1".repeat(64)}`,
        files: [{ fileName: "evidence.pdf", mimeType: "application/pdf", fileBase64: "SGVsbG8=" }],
      }),
    });

    const response = await handleCreateMilestoneDispute(request, "p1", "m1");
    expect(response.status).toBe(401);
    expect(createMilestoneDisputeForParticipant).not.toHaveBeenCalled();
  });
});
