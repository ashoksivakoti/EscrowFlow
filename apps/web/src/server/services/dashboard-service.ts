import { DisputeStatus, MilestoneStatus, Prisma, ProjectStatus } from "@prisma/client";
import type {
  ClientDashboard,
  DashboardActionItem,
  DashboardRecentTransaction,
  FreelancerDashboard,
  NotificationListItem,
  ProjectSummary,
  UserPublicRef,
} from "@escrowflow/types";

import { prisma } from "@/lib/prisma";

const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD];
const CLIENT_REVIEW_MILESTONE_STATUSES: MilestoneStatus[] = [
  MilestoneStatus.SUBMITTED,
  MilestoneStatus.CLIENT_REVIEW,
];
const FREELANCER_DELIVERY_STATUSES: MilestoneStatus[] = [
  MilestoneStatus.FUNDED,
  MilestoneStatus.IN_PROGRESS,
  MilestoneStatus.REJECTED,
];
const FREELANCER_UNDER_REVIEW_STATUSES: MilestoneStatus[] = [
  MilestoneStatus.SUBMITTED,
  MilestoneStatus.CLIENT_REVIEW,
];
const OPEN_DISPUTE_STATUSES: DisputeStatus[] = [
  DisputeStatus.OPEN,
  DisputeStatus.AWAITING_RESPONSE,
  DisputeStatus.UNDER_ADMIN_REVIEW,
];

export async function buildClientDashboard(userId: string): Promise<ClientDashboard> {
  const [
    activeProjectsRaw,
    awaitingFreelancerRaw,
    awaitingEscrowRaw,
    totalTrackedProjectCount,
    reviewMilestones,
    openDisputes,
    recentTxRaw,
    notificationsRaw,
    unreadNotificationsCount,
  ] = await prisma.$transaction([
    prisma.project.findMany({
      where: { clientUserId: userId, status: { in: ACTIVE_PROJECT_STATUSES } },
      orderBy: { updatedAt: "desc" },
      take: 8,
      include: projectSummaryInclude(),
    }),
    prisma.project.findMany({
      where: { clientUserId: userId, status: ProjectStatus.AWAITING_FREELANCER },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: projectSummaryInclude(),
    }),
    prisma.project.findMany({
      where: { clientUserId: userId, status: ProjectStatus.AWAITING_ESCROW },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: projectSummaryInclude(),
    }),
    prisma.project.count({
      where: { clientUserId: userId },
    }),
    prisma.milestone.findMany({
      where: {
        project: { clientUserId: userId },
        status: { in: CLIENT_REVIEW_MILESTONE_STATUSES },
      },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        dueAt: true,
        projectId: true,
        project: { select: { title: true } },
      },
    }),
    prisma.dispute.findMany({
      where: {
        status: { in: OPEN_DISPUTE_STATUSES },
        milestone: { project: { clientUserId: userId } },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        milestoneId: true,
        milestone: { select: { projectId: true, project: { select: { title: true } } } },
      },
    }),
    prisma.transactionLog.findMany({
      where: {
        OR: [{ project: { clientUserId: userId } }, { initiatedByUserId: userId }],
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: 10,
      select: {
        txHash: true,
        blockNumber: true,
        logIndex: true,
        eventName: true,
        projectId: true,
        milestoneId: true,
        payload: true,
        createdAt: true,
      },
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        projectId: true,
        milestoneId: true,
        data: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  const activeProjects = activeProjectsRaw.map(mapProjectSummary);
  const awaitingFreelancer = awaitingFreelancerRaw.map(mapProjectSummary);
  const awaitingEscrow = awaitingEscrowRaw.map(mapProjectSummary);

  const actions: DashboardActionItem[] = [
    ...awaitingEscrow.map((project) => ({
      kind: "PROJECT_AWAITING_ESCROW" as const,
      title: `${project.title} is waiting for escrow funding`,
      href: `/projects/${project.id}/funding`,
      projectId: project.id,
      priority: "high" as const,
    })),
    ...reviewMilestones.map((milestone) => ({
      kind: "MILESTONE_CLIENT_REVIEW" as const,
      title: `Review milestone deliverable in ${milestone.project.title}`,
      href: `/projects/${milestone.projectId}`,
      projectId: milestone.projectId,
      milestoneId: milestone.id,
      dueAt: milestone.dueAt?.toISOString(),
      priority: "high" as const,
    })),
    ...openDisputes.map((dispute) => ({
      kind: "DISPUTE_OPEN" as const,
      title: `Resolve dispute in ${dispute.milestone.project.title}`,
      href: `/projects/${dispute.milestone.projectId}`,
      projectId: dispute.milestone.projectId,
      milestoneId: dispute.milestoneId,
      disputeId: dispute.id,
      priority: "high" as const,
    })),
  ].slice(0, 12);

  return {
    role: "CLIENT",
    summary: {
      activeProjectsCount: activeProjects.length,
      pendingActionsCount: actions.length,
      unreadNotificationsCount,
      awaitingEscrowCount: awaitingEscrow.length,
      totalTrackedProjectCount,
    },
    activeProjects,
    awaitingFreelancer,
    awaitingEscrow,
    actions,
    recentTransactions: recentTxRaw.map(mapRecentTransaction),
    notifications: notificationsRaw.map(mapNotificationPreview),
  };
}

export async function buildFreelancerDashboard(
  userId: string,
): Promise<FreelancerDashboard> {
  const [
    activeProjectsRaw,
    deliveryMilestones,
    underReviewMilestonesCount,
    openDisputes,
    recentTxRaw,
    notificationsRaw,
    unreadNotificationsCount,
  ] = await prisma.$transaction([
    prisma.project.findMany({
      where: {
        freelancerUserId: userId,
        status: { in: ACTIVE_PROJECT_STATUSES },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      include: projectSummaryInclude(),
    }),
    prisma.milestone.findMany({
      where: {
        project: { freelancerUserId: userId },
        status: { in: FREELANCER_DELIVERY_STATUSES },
      },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        dueAt: true,
        status: true,
        projectId: true,
        project: { select: { title: true } },
      },
    }),
    prisma.milestone.count({
      where: {
        project: { freelancerUserId: userId },
        status: { in: FREELANCER_UNDER_REVIEW_STATUSES },
      },
    }),
    prisma.dispute.findMany({
      where: {
        status: { in: OPEN_DISPUTE_STATUSES },
        milestone: { project: { freelancerUserId: userId } },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        milestoneId: true,
        milestone: { select: { projectId: true, project: { select: { title: true } } } },
      },
    }),
    prisma.transactionLog.findMany({
      where: {
        OR: [{ project: { freelancerUserId: userId } }, { initiatedByUserId: userId }],
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: 10,
      select: {
        txHash: true,
        blockNumber: true,
        logIndex: true,
        eventName: true,
        projectId: true,
        milestoneId: true,
        payload: true,
        createdAt: true,
      },
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        projectId: true,
        milestoneId: true,
        data: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
  ]);

  const activeProjects = activeProjectsRaw.map(mapProjectSummary);
  const milestonesToDeliver: DashboardActionItem[] = deliveryMilestones.map((milestone) => ({
    kind: "MILESTONE_DELIVERY_DUE",
    title: `Deliver next milestone for ${milestone.project.title}`,
    href: `/projects/${milestone.projectId}`,
    projectId: milestone.projectId,
    milestoneId: milestone.id,
    dueAt: milestone.dueAt?.toISOString(),
    priority:
      milestone.status === MilestoneStatus.REJECTED
        ? "high"
        : milestone.dueAt
          ? "medium"
          : "low",
  }));

  const actions: DashboardActionItem[] = [
    ...milestonesToDeliver,
    ...openDisputes.map((dispute) => ({
      kind: "DISPUTE_OPEN" as const,
      title: `Respond to dispute in ${dispute.milestone.project.title}`,
      href: `/projects/${dispute.milestone.projectId}`,
      projectId: dispute.milestone.projectId,
      milestoneId: dispute.milestoneId,
      disputeId: dispute.id,
      priority: "high" as const,
    })),
  ].slice(0, 12);

  return {
    role: "FREELANCER",
    summary: {
      activeProjectsCount: activeProjects.length,
      pendingActionsCount: actions.length,
      unreadNotificationsCount,
      milestonesToDeliverCount: milestonesToDeliver.length,
      underReviewMilestonesCount,
    },
    activeProjects,
    milestonesToDeliver,
    actions,
    recentTransactions: recentTxRaw.map(mapRecentTransaction),
    notifications: notificationsRaw.map(mapNotificationPreview),
  };
}

function projectSummaryInclude() {
  return {
    client: { include: { profile: true } },
    freelancer: { include: { profile: true } },
    _count: { select: { milestones: true } },
  } as const;
}

function mapProjectSummary(project: {
  id: string;
  status: ProjectStatus;
  title: string;
  chainId: number | null;
  escrowContractAddress: string | null;
  onChainProjectId: string | null;
  paymentTokenAddress: string | null;
  totalValueWei: string | null;
  agreementIpfsUri: string | null;
  updatedAt: Date;
  client: {
    id: string;
    walletAddress: string;
    profile: { displayName: string; avatarUrl: string | null } | null;
  };
  freelancer: {
    id: string;
    walletAddress: string;
    profile: { displayName: string; avatarUrl: string | null } | null;
  } | null;
  _count: { milestones: number };
}): ProjectSummary {
  return {
    id: project.id,
    status: project.status,
    title: project.title,
    chainId: project.chainId,
    escrowContractAddress: project.escrowContractAddress,
    onChainProjectId: project.onChainProjectId,
    paymentTokenAddress: project.paymentTokenAddress,
    totalValueWei: project.totalValueWei,
    client: toUserPublicRef(project.client),
    freelancer: project.freelancer ? toUserPublicRef(project.freelancer) : null,
    agreementIpfsUri: project.agreementIpfsUri,
    milestoneCount: project._count.milestones,
    openDisputeCount: 0,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toUserPublicRef(user: {
  id: string;
  walletAddress: string;
  profile: { displayName: string; avatarUrl: string | null } | null;
}): UserPublicRef {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    displayName: user.profile?.displayName ?? null,
    avatarUrl: user.profile?.avatarUrl ?? null,
  };
}

function mapRecentTransaction(tx: {
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
  eventName: string;
  projectId: string | null;
  milestoneId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): DashboardRecentTransaction {
  const payloadObject = tx.payload && typeof tx.payload === "object" ? tx.payload : null;
  const blockTimestampRaw =
    payloadObject && "blockTimestamp" in payloadObject
      ? (payloadObject.blockTimestamp as unknown)
      : null;
  return {
    txHash: tx.txHash,
    blockNumber: tx.blockNumber.toString(),
    logIndex: tx.logIndex,
    eventName: tx.eventName,
    projectId: tx.projectId,
    milestoneId: tx.milestoneId,
    createdAt: tx.createdAt.toISOString(),
    blockTimestamp: typeof blockTimestampRaw === "string" ? blockTimestampRaw : null,
  };
}

function mapNotificationPreview(notification: {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: Date | null;
  projectId: string | null;
  milestoneId: string | null;
  data: Prisma.JsonValue;
  createdAt: Date;
}): NotificationListItem {
  const data =
    notification.data && typeof notification.data === "object" && !Array.isArray(notification.data)
      ? (notification.data as Record<string, unknown>)
      : null;
  return {
    id: notification.id,
    type: notification.type as NotificationListItem["type"],
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt?.toISOString() ?? null,
    projectId: notification.projectId,
    milestoneId: notification.milestoneId,
    data,
    createdAt: notification.createdAt.toISOString(),
  };
}
