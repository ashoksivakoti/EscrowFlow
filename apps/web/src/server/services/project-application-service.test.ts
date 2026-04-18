import { afterEach, describe, expect, it, vi } from "vitest";

import { Prisma, ProjectApplicationStatus, ProjectStatus, ProjectVisibility } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPlatformRole: { findMany: vi.fn() },
    project: { findUnique: vi.fn() },
    projectApplication: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  prismaInteractiveTransactionOptions: {},
}));

vi.mock("@/server/services/notification-events", () => ({
  notifyProjectApplicationReceived: vi.fn(),
  notifyProjectApplicationAccepted: vi.fn(),
  notifyProjectApplicationsDeclined: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  notifyProjectApplicationAccepted,
  notifyProjectApplicationReceived,
  notifyProjectApplicationsDeclined,
} from "@/server/services/notification-events";
import {
  acceptProjectApplication,
  applyToProject,
  declineProjectApplication,
  listProjectApplicationsForClient,
  withdrawProjectApplication,
} from "@/server/services/project-application-service";

const CLIENT_ID = "client_1";
const FL_ID = "freelancer_1";
const FL2_ID = "freelancer_2";
const PROJECT_ID = "proj_1";
const APP_1 = "app_1";
const APP_2 = "app_2";

const openPublicProject = {
  id: PROJECT_ID,
  title: "Marketplace project",
  clientUserId: CLIENT_ID,
  status: ProjectStatus.OPEN,
  visibility: ProjectVisibility.PUBLIC,
  freelancerUserId: null as string | null,
};

const validPortfolio = "https://example.com/freelancer-portfolio";

const validApplyBody = {
  coverLetter: "This cover letter has more than twenty characters.",
  portfolioLink: validPortfolio,
  proposedTimeline: null as string | null,
};

const freelancerRow = {
  id: FL_ID,
  walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  profile: { displayName: "Freelancer", avatarUrl: null as string | null },
};

function mockFreelancerRole() {
  vi.mocked(prisma.userPlatformRole.findMany).mockResolvedValue([{ role: "FREELANCER" }] as never);
}

function createdApplicationRow(overrides?: Partial<{ id: string; status: ProjectApplicationStatus }>) {
  const now = new Date();
  return {
    id: overrides?.id ?? APP_1,
    projectId: PROJECT_ID,
    coverLetter: validApplyBody.coverLetter,
    portfolioLink: validPortfolio,
    proposedTimeline: null,
    status: overrides?.status ?? ProjectApplicationStatus.PENDING,
    createdAt: now,
    updatedAt: now,
    freelancer: freelancerRow,
  };
}

function createTransactionMock(tx: {
  project: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  projectApplication: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany?: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
}) {
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => {
    await fn(tx);
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("applyToProject", () => {
  it("allows a freelancer to apply successfully to an open public unassigned project", async () => {
    mockFreelancerRole();
    vi.mocked(prisma.project.findUnique).mockResolvedValue(openPublicProject as never);
    const created = createdApplicationRow();
    vi.mocked(prisma.projectApplication.create).mockResolvedValue(created as never);

    const result = await applyToProject(PROJECT_ID, FL_ID, validApplyBody);

    expect(result.application.status).toBe("PENDING");
    expect(result.application.freelancer.id).toBe(FL_ID);
    expect(prisma.projectApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
          freelancerUserId: FL_ID,
          status: ProjectApplicationStatus.PENDING,
        }),
      }),
    );
    expect(notifyProjectApplicationReceived).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      projectTitle: "Marketplace project",
      clientUserId: CLIENT_ID,
      applicantLabel: "Freelancer",
    });
  });

  it("rejects duplicate apply (unique constraint) with 409", async () => {
    mockFreelancerRole();
    vi.mocked(prisma.project.findUnique).mockResolvedValue(openPublicProject as never);
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    vi.mocked(prisma.projectApplication.create).mockRejectedValue(err);

    await expect(applyToProject(PROJECT_ID, FL_ID, validApplyBody)).rejects.toMatchObject({
      status: 409,
      code: "APPLICATION_ALREADY_EXISTS",
    });
  });

  it("rejects when freelancer has no FREELANCER platform role", async () => {
    vi.mocked(prisma.userPlatformRole.findMany).mockResolvedValue([]);

    await expect(applyToProject(PROJECT_ID, FL_ID, validApplyBody)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("rejects when project does not exist", async () => {
    mockFreelancerRole();
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

    await expect(applyToProject(PROJECT_ID, FL_ID, validApplyBody)).rejects.toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
    expect(prisma.projectApplication.create).not.toHaveBeenCalled();
  });

  it("rejects when client applies to own project", async () => {
    mockFreelancerRole();
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...openPublicProject,
      clientUserId: FL_ID,
    } as never);

    await expect(
      applyToProject(PROJECT_ID, FL_ID, {
        ...validApplyBody,
        coverLetter: "Another valid length cover letter text here.",
      }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_APPLICANT" });
    expect(prisma.projectApplication.create).not.toHaveBeenCalled();
  });

  it("rejects when project already has assigned freelancer (still OPEN edge)", async () => {
    mockFreelancerRole();
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...openPublicProject,
      freelancerUserId: FL2_ID,
    } as never);

    await expect(applyToProject(PROJECT_ID, FL_ID, validApplyBody)).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_NOT_OPEN_FOR_APPLICATIONS",
    });
    expect(prisma.projectApplication.create).not.toHaveBeenCalled();
  });

  it("rejects when project is not OPEN", async () => {
    mockFreelancerRole();
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...openPublicProject,
      status: ProjectStatus.AWAITING_ESCROW,
    } as never);

    await expect(applyToProject(PROJECT_ID, FL_ID, validApplyBody)).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_NOT_OPEN_FOR_APPLICATIONS",
    });
  });

  it("rejects when project is not PUBLIC", async () => {
    mockFreelancerRole();
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...openPublicProject,
      visibility: ProjectVisibility.PRIVATE,
    } as never);

    await expect(applyToProject(PROJECT_ID, FL_ID, validApplyBody)).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_NOT_OPEN_FOR_APPLICATIONS",
    });
  });
});

describe("listProjectApplicationsForClient", () => {
  const appRow = createdApplicationRow();

  it("returns applications for the owning client", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ clientUserId: CLIENT_ID } as never);
    vi.mocked(prisma.projectApplication.findMany).mockResolvedValue([appRow] as never);

    const result = await listProjectApplicationsForClient(PROJECT_ID, CLIENT_ID);

    expect(result.applications).toHaveLength(1);
    expect(result.applications[0].id).toBe(APP_1);
    expect(prisma.projectApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: PROJECT_ID } }),
    );
  });

  it("returns empty list when there are no applications", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ clientUserId: CLIENT_ID } as never);
    vi.mocked(prisma.projectApplication.findMany).mockResolvedValue([]);

    const result = await listProjectApplicationsForClient(PROJECT_ID, CLIENT_ID);

    expect(result.applications).toEqual([]);
  });

  it("returns 403 when caller is not the project client", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ clientUserId: CLIENT_ID } as never);

    await expect(listProjectApplicationsForClient(PROJECT_ID, FL_ID)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(prisma.projectApplication.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when project does not exist", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

    await expect(listProjectApplicationsForClient(PROJECT_ID, CLIENT_ID)).rejects.toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
  });
});

describe("acceptProjectApplication", () => {
  it("accepts one application, declines other pendings, assigns project to AWAITING_ESCROW", async () => {
    const tx = {
      project: {
        findUnique: vi.fn().mockResolvedValue(openPublicProject),
        update: vi.fn().mockResolvedValue({}),
      },
      projectApplication: {
        findFirst: vi.fn().mockResolvedValue({
          id: APP_1,
          status: ProjectApplicationStatus.PENDING,
          freelancerUserId: FL_ID,
        }),
        findMany: vi.fn().mockResolvedValue([{ freelancerUserId: FL2_ID }]),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    createTransactionMock(tx);

    await acceptProjectApplication(PROJECT_ID, APP_1, CLIENT_ID);

    expect(tx.projectApplication.update).toHaveBeenCalledWith({
      where: { id: APP_1 },
      data: { status: ProjectApplicationStatus.ACCEPTED },
    });
    expect(tx.projectApplication.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        id: { not: APP_1 },
        status: ProjectApplicationStatus.PENDING,
      },
      data: { status: ProjectApplicationStatus.DECLINED },
    });
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: {
        freelancerUserId: FL_ID,
        status: ProjectStatus.AWAITING_ESCROW,
      },
    });
    expect(notifyProjectApplicationAccepted).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      projectTitle: "Marketplace project",
      freelancerUserId: FL_ID,
    });
    expect(tx.projectApplication.findMany).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        id: { not: APP_1 },
        status: ProjectApplicationStatus.PENDING,
      },
      select: { freelancerUserId: true },
    });
    expect(notifyProjectApplicationsDeclined).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      projectTitle: "Marketplace project",
      freelancerUserIds: [FL2_ID],
      reason: "OTHER_CANDIDATE_ACCEPTED",
    });
  });

  it("does not notify declines when there were no other pending applicants", async () => {
    const tx = {
      project: {
        findUnique: vi.fn().mockResolvedValue(openPublicProject),
        update: vi.fn().mockResolvedValue({}),
      },
      projectApplication: {
        findFirst: vi.fn().mockResolvedValue({
          id: APP_1,
          status: ProjectApplicationStatus.PENDING,
          freelancerUserId: FL_ID,
        }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    createTransactionMock(tx);

    await acceptProjectApplication(PROJECT_ID, APP_1, CLIENT_ID);

    expect(notifyProjectApplicationAccepted).toHaveBeenCalled();
    expect(notifyProjectApplicationsDeclined).not.toHaveBeenCalled();
  });

  it("rejects when project is missing", async () => {
    const tx = {
      project: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      projectApplication: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    createTransactionMock(tx);

    await expect(acceptProjectApplication(PROJECT_ID, APP_1, CLIENT_ID)).rejects.toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
    expect(tx.projectApplication.findFirst).not.toHaveBeenCalled();
  });

  it("rejects when caller is not the client", async () => {
    const tx = {
      project: {
        findUnique: vi.fn().mockResolvedValue(openPublicProject),
        update: vi.fn(),
      },
      projectApplication: {
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    createTransactionMock(tx);

    await expect(acceptProjectApplication(PROJECT_ID, APP_1, FL_ID)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("rejects when project is no longer a public listing (e.g. already funded path)", async () => {
    const tx = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          ...openPublicProject,
          status: ProjectStatus.AWAITING_ESCROW,
          freelancerUserId: null,
        }),
        update: vi.fn(),
      },
      projectApplication: {
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    createTransactionMock(tx);

    await expect(acceptProjectApplication(PROJECT_ID, APP_1, CLIENT_ID)).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_NOT_OPEN_FOR_APPLICATIONS",
    });
  });

  it("rejects when application is not found", async () => {
    const tx = {
      project: {
        findUnique: vi.fn().mockResolvedValue(openPublicProject),
        update: vi.fn(),
      },
      projectApplication: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    createTransactionMock(tx);

    await expect(acceptProjectApplication(PROJECT_ID, "missing", CLIENT_ID)).rejects.toMatchObject({
      status: 404,
      code: "APPLICATION_NOT_FOUND",
    });
  });

  it("rejects when application is not PENDING", async () => {
    const tx = {
      project: {
        findUnique: vi.fn().mockResolvedValue(openPublicProject),
        update: vi.fn(),
      },
      projectApplication: {
        findFirst: vi.fn().mockResolvedValue({
          id: APP_1,
          status: ProjectApplicationStatus.DECLINED,
          freelancerUserId: FL_ID,
        }),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    createTransactionMock(tx);

    await expect(acceptProjectApplication(PROJECT_ID, APP_1, CLIENT_ID)).rejects.toMatchObject({
      status: 409,
      code: "APPLICATION_NOT_PENDING",
    });
  });

  it("rejects when project is OPEN but not PUBLIC", async () => {
    const tx = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          ...openPublicProject,
          visibility: ProjectVisibility.PRIVATE,
        }),
        update: vi.fn(),
      },
      projectApplication: {
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    createTransactionMock(tx);

    await expect(acceptProjectApplication(PROJECT_ID, APP_1, CLIENT_ID)).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_NOT_OPEN_FOR_APPLICATIONS",
    });
  });
});

describe("declineProjectApplication", () => {
  it("declines a pending application for the owning client", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      clientUserId: CLIENT_ID,
      title: "Marketplace project",
    } as never);
    vi.mocked(prisma.projectApplication.findFirst).mockResolvedValue({
      id: APP_1,
      status: ProjectApplicationStatus.PENDING,
      freelancerUserId: FL_ID,
    } as never);
    vi.mocked(prisma.projectApplication.update).mockResolvedValue({} as never);

    await declineProjectApplication(PROJECT_ID, APP_1, CLIENT_ID);

    expect(prisma.projectApplication.update).toHaveBeenCalledWith({
      where: { id: APP_1 },
      data: { status: ProjectApplicationStatus.DECLINED },
    });
    expect(notifyProjectApplicationsDeclined).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      projectTitle: "Marketplace project",
      freelancerUserIds: [FL_ID],
      reason: "CLIENT_DECLINED",
    });
  });

  it("rejects decline when caller is not the client", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ clientUserId: CLIENT_ID } as never);

    await expect(declineProjectApplication(PROJECT_ID, APP_1, FL_ID)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(prisma.projectApplication.findFirst).not.toHaveBeenCalled();
  });

  it("rejects decline when application is not pending", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ clientUserId: CLIENT_ID } as never);
    vi.mocked(prisma.projectApplication.findFirst).mockResolvedValue({
      id: APP_1,
      status: ProjectApplicationStatus.ACCEPTED,
    } as never);

    await expect(declineProjectApplication(PROJECT_ID, APP_1, CLIENT_ID)).rejects.toMatchObject({
      status: 409,
      code: "APPLICATION_NOT_PENDING",
    });
    expect(prisma.projectApplication.update).not.toHaveBeenCalled();
  });

  it("returns 404 when application id does not exist on project", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ clientUserId: CLIENT_ID } as never);
    vi.mocked(prisma.projectApplication.findFirst).mockResolvedValue(null);

    await expect(declineProjectApplication(PROJECT_ID, "unknown", CLIENT_ID)).rejects.toMatchObject({
      status: 404,
      code: "APPLICATION_NOT_FOUND",
    });
  });
});

describe("withdrawProjectApplication", () => {
  it("allows freelancer to withdraw their pending application", async () => {
    vi.mocked(prisma.projectApplication.findFirst).mockResolvedValue({
      id: APP_1,
      status: ProjectApplicationStatus.PENDING,
    } as never);
    vi.mocked(prisma.projectApplication.update).mockResolvedValue({} as never);

    await withdrawProjectApplication(PROJECT_ID, APP_1, FL_ID);

    expect(prisma.projectApplication.findFirst).toHaveBeenCalledWith({
      where: { id: APP_1, projectId: PROJECT_ID, freelancerUserId: FL_ID },
      select: { id: true, status: true },
    });
    expect(prisma.projectApplication.update).toHaveBeenCalledWith({
      where: { id: APP_1 },
      data: { status: ProjectApplicationStatus.WITHDRAWN },
    });
  });

  it("returns 404 when application does not belong to freelancer", async () => {
    vi.mocked(prisma.projectApplication.findFirst).mockResolvedValue(null);

    await expect(withdrawProjectApplication(PROJECT_ID, APP_1, FL_ID)).rejects.toMatchObject({
      status: 404,
      code: "APPLICATION_NOT_FOUND",
    });
  });

  it("rejects withdraw when application is not pending", async () => {
    vi.mocked(prisma.projectApplication.findFirst).mockResolvedValue({
      id: APP_1,
      status: ProjectApplicationStatus.ACCEPTED,
    } as never);

    await expect(withdrawProjectApplication(PROJECT_ID, APP_1, FL_ID)).rejects.toMatchObject({
      status: 409,
      code: "APPLICATION_NOT_PENDING",
    });
  });
});
