import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/admin-dispute-service", () => ({
  listAdminDisputes: vi.fn(),
  resolveDisputeAsAdmin: vi.fn(),
}));

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleListAdminDisputes } from "@/server/route-handlers/v1/admin/disputes/list";
import { handleResolveDispute } from "@/server/route-handlers/v1/admin/disputes/resolve";
import {
  listAdminDisputes,
  resolveDisputeAsAdmin,
} from "@/server/services/admin-dispute-service";

afterEach(() => {
  vi.clearAllMocks();
});

function mockAdminAuth() {
  vi.mocked(requireAuthenticated).mockResolvedValue({
    userId: "admin_1",
    session: {
      id: "admin_1",
      walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      roles: ["ADMIN"],
      profile: null,
      lastLoginAt: null,
    },
  });
}

describe("admin disputes handlers", () => {
  it("lists admin disputes", async () => {
    mockAdminAuth();
    vi.mocked(listAdminDisputes).mockResolvedValue({ items: [] });
    const request = new Request("http://localhost/api/v1/admin/disputes?status=open&limit=10");

    const response = await handleListAdminDisputes(request);
    expect(response.status).toBe(200);
    expect(listAdminDisputes).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open", limit: 10 }),
    );
  });

  it("resolves a dispute as admin", async () => {
    mockAdminAuth();
    vi.mocked(resolveDisputeAsAdmin).mockResolvedValue({
      dispute: {
        id: "dispute_1",
        milestoneId: "milestone_1",
        status: "RESOLVED_SPLIT",
        title: "Milestone dispute",
        evidenceIpfsUri: "ipfs://bafy-dispute",
        openedBy: {
          id: "client_1",
          walletAddress: "0x1111111111111111111111111111111111111111",
          displayName: "Client",
          avatarUrl: null,
        },
        relatedSubmissionId: "submission_1",
        resolvedAt: new Date().toISOString(),
        resolutionTxHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        createdAt: new Date().toISOString(),
        description: "Issue details",
        resolvedBy: {
          id: "admin_1",
          walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          displayName: "Admin",
          avatarUrl: null,
        },
        updatedAt: new Date().toISOString(),
        project: {
          id: "project_1",
          title: "Escrow Project",
          status: "ACTIVE",
          chainId: 31337,
          escrowContractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
          onChainProjectId: "1",
          paymentTokenAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
          totalValueWei: "1000000",
          fundedAmountWei: "1000000",
          releasedAmountWei: "600000",
        },
        milestone: {
          id: "milestone_1",
          sortOrder: 0,
          title: "M1",
          status: "RELEASED",
          amountWei: "1000000",
          dueAt: null,
          latestSubmissionId: "submission_1",
        },
        participants: {
          client: {
            id: "client_1",
            walletAddress: "0x1111111111111111111111111111111111111111",
            displayName: "Client",
            avatarUrl: null,
          },
          freelancer: {
            id: "freelancer_1",
            walletAddress: "0x2222222222222222222222222222222222222222",
            displayName: "Freelancer",
            avatarUrl: null,
          },
        },
        relatedSubmission: {
          id: "submission_1",
          status: "SUBMITTED",
          submittedAt: null,
          note: "Work note",
        },
        evidenceLinks: ["ipfs://bafy-dispute"],
        resolution: {
          kind: "SPLIT",
          freelancerAmountWei: "600000",
          clientAmountWei: "400000",
          note: "Split based on delivered scope",
        },
        recentTransactions: [],
      },
    });

    const request = new Request("http://localhost/api/v1/admin/disputes/dispute_1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "SPLIT",
        freelancerAmountWei: "600000",
        clientAmountWei: "400000",
        resolutionNote: "Split based on delivered scope",
      }),
    });
    const response = await handleResolveDispute(request, "dispute_1");
    expect(response.status).toBe(200);
    expect(resolveDisputeAsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: "dispute_1",
        adminUserId: "admin_1",
      }),
    );
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const request = new Request("http://localhost/api/v1/admin/disputes");
    const response = await handleListAdminDisputes(request);
    expect(response.status).toBe(401);
  });
});
