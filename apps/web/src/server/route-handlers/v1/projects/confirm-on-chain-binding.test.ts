import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/guards/authorization-guard", () => ({
  requireRoles: vi.fn(),
}));

vi.mock("@/server/services/project-service", () => ({
  confirmOnChainProjectBinding: vi.fn(),
}));

import { handleConfirmProjectOnChainBinding } from "@/server/route-handlers/v1/projects/confirm-on-chain-binding";
import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { confirmOnChainProjectBinding } from "@/server/services/project-service";

const CLIENT_USER_ID = "client-user-1";
const PROJECT_ID = "proj_1";

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleConfirmProjectOnChainBinding", () => {
  it("returns updated project for client", async () => {
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
    vi.mocked(requireRoles).mockImplementation(() => undefined);

    vi.mocked(confirmOnChainProjectBinding).mockResolvedValue({
      id: PROJECT_ID,
      status: "AWAITING_ESCROW",
      visibility: "PUBLIC",
      title: "T",
      description: null,
      chainId: 31337,
      escrowContractAddress: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
      onChainProjectId: "1",
      paymentTokenAddress: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
      totalValueWei: "100",
      fundedAmountWei: "0",
      releasedAmountWei: "0",
      client: {
        id: CLIENT_USER_ID,
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        displayName: null,
        avatarUrl: null,
      },
      freelancer: {
        id: "fl_1",
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        displayName: null,
        avatarUrl: null,
      },
      agreementIpfsUri: null,
      agreementLinks: [],
      milestoneCount: 1,
      openDisputeCount: 0,
      updatedAt: new Date().toISOString(),
      latestSubmission: null,
      openDispute: null,
      recentTransactions: [],
      milestones: [],
      completedAt: null,
      cancelledAt: null,
      createdAt: new Date().toISOString(),
    });

    const request = new Request(`http://localhost/api/v1/projects/${PROJECT_ID}/on-chain-binding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ onChainProjectId: "1" }),
    });

    const res = await handleConfirmProjectOnChainBinding(request, PROJECT_ID);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { project: { onChainProjectId: string } };
    expect(json.project.onChainProjectId).toBe("1");
    expect(confirmOnChainProjectBinding).toHaveBeenCalledWith(CLIENT_USER_ID, PROJECT_ID, "1");
  });
});
