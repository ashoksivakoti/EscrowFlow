import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/project-service", () => ({
  createProjectForClient: vi.fn(),
}));

import { handleCreateProject } from "@/server/route-handlers/v1/projects/create";
import { requireAuthenticated } from "@/server/guards/auth-guard";
import { createProjectForClient } from "@/server/services/project-service";

const CLIENT_USER_ID = "client-user-1";
const FREELANCER_WALLET = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleCreateProject", () => {
  it("creates project for authenticated client with valid payload", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: CLIENT_USER_ID,
      session: {
        id: CLIENT_USER_ID,
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });

    vi.mocked(createProjectForClient).mockResolvedValue({
      project: {
        id: "project_1",
        status: "AWAITING_ESCROW",
        visibility: "PRIVATE",
        title: "Website redesign",
        description: "Design + frontend implementation",
        chainId: null,
        escrowContractAddress: null,
        onChainProjectId: null,
        paymentTokenAddress: null,
        totalValueWei: "3000000",
        fundedAmountWei: "0",
        releasedAmountWei: "0",
        client: {
          id: CLIENT_USER_ID,
          walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          displayName: "Client",
          avatarUrl: null,
        },
        freelancer: {
          id: "freelancer_1",
          walletAddress: FREELANCER_WALLET,
          displayName: "Freelancer",
          avatarUrl: null,
        },
        agreementIpfsUri: "ipfs://bafybeigdyrzt",
        agreementLinks: ["ipfs://bafybeigdyrzt"],
        milestoneCount: 2,
        openDisputeCount: 0,
        updatedAt: new Date().toISOString(),
        latestSubmission: null,
        openDispute: null,
        recentTransactions: [],
        milestones: [],
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    const request = new Request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Website redesign",
        description: "Design + frontend implementation",
        freelancerWalletAddress: FREELANCER_WALLET,
        milestones: [
          {
            title: "Discovery",
            description: "Initial wireframes",
            amountWei: "1000000",
            dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
          {
            title: "Build",
            amountWei: "2000000",
            dueAt: new Date(Date.now() + 86_400_000 * 7).toISOString(),
          },
        ],
        agreement: {
          mode: "metadata",
          metadata: {
            schema: "escrowflow.project-agreement.v1",
            title: "Website redesign agreement",
          },
        },
      }),
    });

    const response = await handleCreateProject(request);
    const body = (await response.json()) as { project: { id: string } };

    expect(response.status).toBe(201);
    expect(body.project.id).toBe("project_1");
    expect(createProjectForClient).toHaveBeenCalledOnce();
    expect(createProjectForClient).toHaveBeenCalledWith(
      CLIENT_USER_ID,
      expect.objectContaining({ title: "Website redesign" }),
    );
  });

  it("returns validation error on invalid payload", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: CLIENT_USER_ID,
      session: {
        id: CLIENT_USER_ID,
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        roles: ["CLIENT"],
        profile: null,
        lastLoginAt: null,
      },
    });

    const request = new Request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "x",
        freelancerWalletAddress: "not-a-wallet",
        milestones: [],
      }),
    });

    const response = await handleCreateProject(request);
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: unknown };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(createProjectForClient).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(
      AppError.unauthenticated("Authentication required"),
    );

    const request = new Request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await handleCreateProject(request);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(createProjectForClient).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated user is not CLIENT role", async () => {
    vi.mocked(requireAuthenticated).mockResolvedValue({
      userId: "freelancer-only",
      session: {
        id: "freelancer-only",
        walletAddress: FREELANCER_WALLET,
        roles: ["FREELANCER"],
        profile: null,
        lastLoginAt: null,
      },
    });

    const request = new Request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Website redesign",
        freelancerWalletAddress: FREELANCER_WALLET,
        milestones: [
          {
            title: "Build",
            amountWei: "1000000",
            dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        ],
      }),
    });

    const response = await handleCreateProject(request);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(createProjectForClient).not.toHaveBeenCalled();
  });
});
