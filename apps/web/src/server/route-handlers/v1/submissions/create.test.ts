import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors/app-error";

vi.mock("@/server/guards/auth-guard", () => ({
  requireAuthenticated: vi.fn(),
}));

vi.mock("@/server/services/submission-service", () => ({
  createMilestoneSubmissionForFreelancer: vi.fn(),
}));

import { handleCreateMilestoneSubmission } from "@/server/route-handlers/v1/submissions/create";
import { requireAuthenticated } from "@/server/guards/auth-guard";
import { createMilestoneSubmissionForFreelancer } from "@/server/services/submission-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleCreateMilestoneSubmission", () => {
  it("creates submission for authenticated freelancer", async () => {
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
    vi.mocked(createMilestoneSubmissionForFreelancer).mockResolvedValue({
      submission: {
        id: "submission_1",
        milestoneId: "milestone_1",
        status: "SUBMITTED",
        attemptNumber: 1,
        deliverablesIpfsUri: "ipfs://bafy-submission",
        summary: "First delivery",
        note: "First delivery",
        externalLink: "https://example.com/demo",
        metadataIpfsUri: "ipfs://bafy-metadata",
        deliverableFiles: [],
        submittedBy: {
          id: "freelancer_1",
          walletAddress: "0x1111111111111111111111111111111111111111",
          displayName: "Freelancer",
          avatarUrl: null,
        },
        submittedAt: new Date().toISOString(),
        decidedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const request = new Request("http://localhost/api/v1/projects/p1/milestones/m1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: "First delivery",
        externalLink: "https://example.com/demo",
        files: [
          {
            fileName: "deliverable.pdf",
            mimeType: "application/pdf",
            fileBase64: "SGVsbG8=",
          },
        ],
      }),
    });

    const response = await handleCreateMilestoneSubmission(request, "p1", "m1");
    const body = (await response.json()) as { submission: { id: string } };

    expect(response.status).toBe(201);
    expect(body.submission.id).toBe("submission_1");
    expect(createMilestoneSubmissionForFreelancer).toHaveBeenCalledWith({
      projectId: "p1",
      milestoneId: "m1",
      freelancerUserId: "freelancer_1",
      payload: expect.objectContaining({ note: "First delivery" }),
    });
  });

  it("returns validation error for invalid link", async () => {
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

    const request = new Request("http://localhost/api/v1/projects/p1/milestones/m1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: "Delivery",
        externalLink: "invalid-link",
        files: [{ fileName: "x.txt", mimeType: "text/plain", fileBase64: "SGVsbG8=" }],
      }),
    });

    const response = await handleCreateMilestoneSubmission(request, "p1", "m1");
    expect(response.status).toBe(400);
    expect(createMilestoneSubmissionForFreelancer).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated user is not freelancer role", async () => {
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

    const request = new Request("http://localhost/api/v1/projects/p1/milestones/m1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: "Delivery",
        files: [{ fileName: "x.txt", mimeType: "text/plain", fileBase64: "SGVsbG8=" }],
      }),
    });

    const response = await handleCreateMilestoneSubmission(request, "p1", "m1");
    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(createMilestoneSubmissionForFreelancer).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuthenticated).mockRejectedValue(AppError.unauthenticated());
    const request = new Request("http://localhost/api/v1/projects/p1/milestones/m1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: "Delivery",
        files: [{ fileName: "x.txt", mimeType: "text/plain", fileBase64: "SGVsbG8=" }],
      }),
    });

    const response = await handleCreateMilestoneSubmission(request, "p1", "m1");
    expect(response.status).toBe(401);
    expect(createMilestoneSubmissionForFreelancer).not.toHaveBeenCalled();
  });
});
