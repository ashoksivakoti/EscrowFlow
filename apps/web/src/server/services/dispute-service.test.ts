import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisputeStatus, MilestoneStatus, ProjectStatus } from "@prisma/client";

const { prismaMock, uploadFileToIpfsMock, uploadJsonToIpfsMock } = vi.hoisted(() => ({
  prismaMock: {
    milestone: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    project: {
      update: vi.fn(),
    },
    dispute: {
      create: vi.fn(),
    },
    transactionLog: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
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

import { createMilestoneDisputeForParticipant } from "@/server/services/dispute-service";

describe("createMilestoneDisputeForParticipant", () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return arg({
          dispute: { create: prismaMock.dispute.create },
          milestone: { update: prismaMock.milestone.update },
          project: { update: prismaMock.project.update },
          transactionLog: { create: prismaMock.transactionLog.create },
        });
      }
      return arg;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates dispute for valid project participant", async () => {
    prismaMock.milestone.findFirst.mockResolvedValue({
      id: "milestone_1",
      status: MilestoneStatus.SUBMITTED,
      project: {
        id: "project_1",
        status: ProjectStatus.ACTIVE,
        chainId: 31337,
        escrowContractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        clientUserId: "client_1",
        freelancerUserId: "freelancer_1",
      },
      disputes: [],
      submissions: [{ id: "submission_1", deliverablesIpfsUri: "ipfs://bafy-submission" }],
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "client_1",
      walletAddress: "0x2222222222222222222222222222222222222222",
      profile: { displayName: "Client", avatarUrl: null },
    });
    uploadFileToIpfsMock.mockResolvedValue({
      cid: "bafy-file",
      uri: "ipfs://bafy-file",
      gatewayUrl: "https://gateway/ipfs/bafy-file",
      sizeBytes: 25,
      contentType: "application/pdf",
    });
    uploadJsonToIpfsMock.mockResolvedValue({
      cid: "bafy-dispute-meta",
      uri: "ipfs://bafy-dispute-meta",
      gatewayUrl: "https://gateway/ipfs/bafy-dispute-meta",
      sizeBytes: 200,
      contentType: "application/json",
    });
    prismaMock.dispute.create.mockResolvedValue({
      id: "dispute_1",
      milestoneId: "milestone_1",
      status: DisputeStatus.OPEN,
      title: "Milestone dispute",
      description: "Work is incomplete",
      evidenceIpfsUri: "ipfs://bafy-dispute-meta",
      relatedSubmissionId: "submission_1",
      resolutionTxHash: null,
      resolvedAt: null,
      createdAt: new Date("2026-04-14T12:00:00.000Z"),
      updatedAt: new Date("2026-04-14T12:00:00.000Z"),
      openedBy: {
        id: "client_1",
        walletAddress: "0x2222222222222222222222222222222222222222",
        profile: { displayName: "Client", avatarUrl: null },
      },
      resolvedBy: null,
    });

    const result = await createMilestoneDisputeForParticipant({
      projectId: "project_1",
      milestoneId: "milestone_1",
      openedByUserId: "client_1",
      payload: {
        reason: "Work is incomplete and does not satisfy acceptance criteria.",
        files: [
          {
            fileName: "evidence.pdf",
            mimeType: "application/pdf",
            fileBase64: "SGVsbG8=",
          },
        ],
        relatedSubmissionId: "submission_1",
      },
    });

    expect(result.dispute.id).toBe("dispute_1");
    expect(prismaMock.dispute.create).toHaveBeenCalledOnce();
    expect(prismaMock.milestone.update).toHaveBeenCalledWith({
      where: { id: "milestone_1" },
      data: { status: MilestoneStatus.DISPUTED },
    });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: "project_1" },
      data: { status: ProjectStatus.DISPUTED },
    });
  });

  it("rejects when user is not participant", async () => {
    prismaMock.milestone.findFirst.mockResolvedValue({
      id: "milestone_1",
      status: MilestoneStatus.SUBMITTED,
      project: {
        id: "project_1",
        status: ProjectStatus.ACTIVE,
        chainId: 31337,
        escrowContractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        clientUserId: "client_1",
        freelancerUserId: "freelancer_1",
      },
      disputes: [],
      submissions: [],
    });

    await expect(
      createMilestoneDisputeForParticipant({
        projectId: "project_1",
        milestoneId: "milestone_1",
        openedByUserId: "random_user",
        payload: {
          reason: "Work is incomplete and does not satisfy acceptance criteria.",
          files: [
            {
              fileName: "evidence.pdf",
              mimeType: "application/pdf",
              fileBase64: "SGVsbG8=",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("rejects when milestone state does not allow disputes", async () => {
    prismaMock.milestone.findFirst.mockResolvedValue({
      id: "milestone_1",
      status: MilestoneStatus.IN_PROGRESS,
      project: {
        id: "project_1",
        status: ProjectStatus.ACTIVE,
        chainId: 31337,
        escrowContractAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
        clientUserId: "client_1",
        freelancerUserId: "freelancer_1",
      },
      disputes: [],
      submissions: [],
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "client_1",
      walletAddress: "0x2222222222222222222222222222222222222222",
      profile: null,
    });

    await expect(
      createMilestoneDisputeForParticipant({
        projectId: "project_1",
        milestoneId: "milestone_1",
        openedByUserId: "client_1",
        payload: {
          reason: "Work is incomplete and does not satisfy acceptance criteria.",
          files: [
            {
              fileName: "evidence.pdf",
              mimeType: "application/pdf",
              fileBase64: "SGVsbG8=",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "MILESTONE_STATE_INVALID_FOR_DISPUTE",
      status: 409,
    });
  });
});
