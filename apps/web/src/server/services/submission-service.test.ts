import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneStatus, ProjectStatus, SubmissionStatus } from "@prisma/client";

import { AppError } from "@/server/errors/app-error";

const { prismaMock, uploadFileToIpfsMock, uploadJsonToIpfsMock } = vi.hoisted(() => ({
  prismaMock: {
    milestone: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    submission: {
      create: vi.fn(),
    },
    transactionLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  uploadFileToIpfsMock: vi.fn(),
  uploadJsonToIpfsMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  prismaInteractiveTransactionOptions: {
    maxWait: 10_000,
    timeout: 15_000,
  },
}));

vi.mock("@/lib/ipfs", () => ({
  uploadFileToIpfs: uploadFileToIpfsMock,
  uploadJsonToIpfs: uploadJsonToIpfsMock,
}));

import { createMilestoneSubmissionForFreelancer } from "@/server/services/submission-service";

describe("createMilestoneSubmissionForFreelancer", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return arg({
          submission: { create: prismaMock.submission.create },
          milestone: { update: prismaMock.milestone.update },
          transactionLog: { create: prismaMock.transactionLog.create },
        });
      }
      return arg;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a valid freelancer submission with IPFS uploads", async () => {
    prismaMock.milestone.findFirst.mockResolvedValue({
      id: "milestone_1",
      sortOrder: 0,
      status: MilestoneStatus.IN_PROGRESS,
      _count: { submissions: 0 },
      project: {
        id: "project_1",
        status: ProjectStatus.ACTIVE,
        freelancerUserId: "freelancer_1",
      },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "freelancer_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: { displayName: "Freelancer", avatarUrl: null },
    });
    uploadFileToIpfsMock.mockResolvedValue({
      cid: "bafyfilecid",
      uri: "ipfs://bafyfilecid",
      gatewayUrl: "https://gateway/ipfs/bafyfilecid",
      sizeBytes: 5,
      contentType: "text/plain",
    });
    uploadJsonToIpfsMock.mockResolvedValue({
      cid: "bafymetacid",
      uri: "ipfs://bafymetacid",
      gatewayUrl: "https://gateway/ipfs/bafymetacid",
      sizeBytes: 100,
      contentType: "application/json",
    });
    prismaMock.submission.create.mockResolvedValue({
      id: "submission_1",
      milestoneId: "milestone_1",
      status: SubmissionStatus.SUBMITTED,
      attemptNumber: 1,
      deliverablesIpfsUri: "ipfs://bafymetacid",
      summary: "Here is my delivery",
      submittedAt: new Date("2026-04-14T12:00:00.000Z"),
      decidedAt: null,
      createdAt: new Date("2026-04-14T12:00:00.000Z"),
      updatedAt: new Date("2026-04-14T12:00:00.000Z"),
      submittedBy: {
        id: "freelancer_1",
        walletAddress: "0x1111111111111111111111111111111111111111",
        profile: { displayName: "Freelancer", avatarUrl: null },
      },
    });

    const response = await createMilestoneSubmissionForFreelancer({
      projectId: "project_1",
      milestoneId: "milestone_1",
      freelancerUserId: "freelancer_1",
      payload: {
        note: "Here is my delivery",
        externalLink: "https://example.com/demo",
        files: [{ fileName: "deliverable.txt", mimeType: "text/plain", fileBase64: "SGVsbG8=" }],
      },
    });

    expect(response.submission.status).toBe("SUBMITTED");
    expect(response.submission.metadataIpfsUri).toBe("ipfs://bafymetacid");
    expect(prismaMock.submission.create).toHaveBeenCalledOnce();
    expect(prismaMock.milestone.update).toHaveBeenCalledWith({
      where: { id: "milestone_1" },
      data: { status: MilestoneStatus.SUBMITTED },
    });
  });

  it("rejects when project state does not allow submissions", async () => {
    prismaMock.milestone.findFirst.mockResolvedValue({
      id: "milestone_1",
      sortOrder: 0,
      status: MilestoneStatus.IN_PROGRESS,
      _count: { submissions: 0 },
      project: {
        id: "project_1",
        status: ProjectStatus.AWAITING_ESCROW,
        freelancerUserId: "freelancer_1",
      },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "freelancer_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: null,
    });

    await expect(
      createMilestoneSubmissionForFreelancer({
        projectId: "project_1",
        milestoneId: "milestone_1",
        freelancerUserId: "freelancer_1",
        payload: {
          note: "Delivery",
          files: [{ fileName: "x.txt", mimeType: "text/plain", fileBase64: "SGVsbG8=" }],
        },
      }),
    ).rejects.toMatchObject({
      code: "PROJECT_STATE_INVALID_FOR_SUBMISSION",
      status: 409,
    });
  });

  it("rejects when milestone state does not allow submissions", async () => {
    prismaMock.milestone.findFirst.mockResolvedValue({
      id: "milestone_1",
      sortOrder: 0,
      status: MilestoneStatus.AWAITING_FUNDS,
      _count: { submissions: 0 },
      project: {
        id: "project_1",
        status: ProjectStatus.ACTIVE,
        freelancerUserId: "freelancer_1",
      },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "freelancer_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: null,
    });

    await expect(
      createMilestoneSubmissionForFreelancer({
        projectId: "project_1",
        milestoneId: "milestone_1",
        freelancerUserId: "freelancer_1",
        payload: {
          note: "Delivery",
          files: [{ fileName: "x.txt", mimeType: "text/plain", fileBase64: "SGVsbG8=" }],
        },
      }),
    ).rejects.toMatchObject({
      code: "MILESTONE_STATE_INVALID_FOR_SUBMISSION",
      status: 409,
    });
  });

  it("rejects when authenticated freelancer is not project member", async () => {
    prismaMock.milestone.findFirst.mockResolvedValue({
      id: "milestone_1",
      sortOrder: 0,
      status: MilestoneStatus.IN_PROGRESS,
      _count: { submissions: 0 },
      project: {
        id: "project_1",
        status: ProjectStatus.ACTIVE,
        freelancerUserId: "freelancer_1",
      },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "freelancer_1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      profile: null,
    });

    await expect(
      createMilestoneSubmissionForFreelancer({
        projectId: "project_1",
        milestoneId: "milestone_1",
        freelancerUserId: "different_user",
        payload: {
          note: "Delivery",
          files: [{ fileName: "x.txt", mimeType: "text/plain", fileBase64: "SGVsbG8=" }],
        },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
