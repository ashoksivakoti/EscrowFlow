import { afterEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  userPlatformRole: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/server/services/notification-service", () => ({
  createNotifications: vi.fn(),
}));

import {
  notifyDisputeRaised,
  notifyDisputeResolved,
  notifyProjectApplicationAccepted,
  notifyProjectApplicationReceived,
  notifyProjectApplicationsDeclined,
  notifyProjectCreated,
} from "@/server/services/notification-events";
import { createNotifications } from "@/server/services/notification-service";

afterEach(() => {
  vi.clearAllMocks();
});

describe("notification-events", () => {
  it("creates participant notifications for project created", async () => {
    await notifyProjectCreated({
      projectId: "project_1",
      projectTitle: "Escrow project",
      clientUserId: "client_1",
      freelancerUserId: "freelancer_1",
    });

    expect(createNotifications).toHaveBeenCalledOnce();
    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "client_1", type: "PROJECT" }),
        expect.objectContaining({ userId: "freelancer_1", type: "PROJECT" }),
      ]),
    );
  });

  it("includes admin queue notifications when dispute is raised", async () => {
    prismaMock.userPlatformRole.findMany.mockResolvedValue([
      { userId: "admin_1" },
      { userId: "admin_2" },
    ]);

    await notifyDisputeRaised({
      projectId: "project_1",
      milestoneId: "milestone_1",
      milestoneTitle: "Milestone",
      openedByUserId: "client_1",
      clientUserId: "client_1",
      freelancerUserId: "freelancer_1",
      disputeId: "dispute_1",
    });

    expect(prismaMock.userPlatformRole.findMany).toHaveBeenCalledOnce();
    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "client_1", type: "DISPUTE" }),
        expect.objectContaining({ userId: "freelancer_1", type: "DISPUTE" }),
        expect.objectContaining({ userId: "admin_1", type: "DISPUTE" }),
        expect.objectContaining({ userId: "admin_2", type: "DISPUTE" }),
      ]),
    );
  });

  it("notifies client when a freelancer applies", async () => {
    await notifyProjectApplicationReceived({
      projectId: "project_1",
      projectTitle: "API integration",
      clientUserId: "client_1",
      applicantLabel: "Alex",
    });

    expect(createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: "client_1",
        type: "PROJECT",
        title: "New application",
        projectId: "project_1",
        data: { event: "PROJECT_APPLICATION_RECEIVED" },
      }),
    ]);
  });

  it("notifies freelancer when their application is accepted", async () => {
    await notifyProjectApplicationAccepted({
      projectId: "project_1",
      projectTitle: "API integration",
      freelancerUserId: "freelancer_1",
    });

    expect(createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: "freelancer_1",
        type: "PROJECT",
        title: "Application accepted",
        projectId: "project_1",
        data: { event: "PROJECT_APPLICATION_ACCEPTED" },
      }),
    ]);
  });

  it("notifies freelancers when applications are declined (client action)", async () => {
    await notifyProjectApplicationsDeclined({
      projectId: "project_1",
      projectTitle: "API integration",
      freelancerUserIds: ["freelancer_a", "freelancer_b"],
      reason: "CLIENT_DECLINED",
    });

    expect(createNotifications).toHaveBeenCalledOnce();
    const firstCall = vi.mocked(createNotifications).mock.calls[0];
    expect(firstCall).toBeDefined();
    const batch = firstCall![0] as Array<{ userId: string }>;
    expect(batch).toHaveLength(2);
    expect(batch.map((n) => n.userId).sort()).toEqual(["freelancer_a", "freelancer_b"].sort());
    expect(batch[0]).toMatchObject({
      type: "PROJECT",
      title: "Application declined",
      data: { event: "PROJECT_APPLICATION_DECLINED", reason: "CLIENT_DECLINED" },
    });
  });

  it("dedupes freelancer ids when notifying bulk declines", async () => {
    await notifyProjectApplicationsDeclined({
      projectId: "project_1",
      projectTitle: "API integration",
      freelancerUserIds: ["u1", "u1", "u2"],
      reason: "OTHER_CANDIDATE_ACCEPTED",
    });

    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "u1" }),
        expect.objectContaining({ userId: "u2" }),
      ]),
    );
    const dedupeCall = vi.mocked(createNotifications).mock.calls[0];
    expect(dedupeCall).toBeDefined();
    expect(dedupeCall![0]).toHaveLength(2);
  });

  it("skips createNotifications when decline list is empty", async () => {
    await notifyProjectApplicationsDeclined({
      projectId: "project_1",
      projectTitle: "API integration",
      freelancerUserIds: [],
      reason: "OTHER_CANDIDATE_ACCEPTED",
    });

    expect(createNotifications).not.toHaveBeenCalled();
  });

  it("creates dispute resolved notifications for both participants", async () => {
    await notifyDisputeResolved({
      projectId: "project_1",
      milestoneId: "milestone_1",
      milestoneTitle: "Milestone",
      clientUserId: "client_1",
      freelancerUserId: "freelancer_1",
      disputeId: "dispute_1",
      outcome: "RESOLVED_SPLIT",
    });

    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "client_1", type: "DISPUTE" }),
        expect.objectContaining({ userId: "freelancer_1", type: "DISPUTE" }),
      ]),
    );
  });
});
