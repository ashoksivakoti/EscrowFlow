import { PlatformRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createNotifications } from "@/server/services/notification-service";

export async function notifyProjectCreated(input: {
  projectId: string;
  projectTitle: string;
  clientUserId: string;
  freelancerUserId: string | null;
  /** When true, client message reflects marketplace listing (no freelancer yet). */
  marketplaceListing?: boolean;
}): Promise<void> {
  const clientBody = input.marketplaceListing
    ? `Project "${input.projectTitle}" is live on the marketplace. Freelancers can apply until you accept one.`
    : `Project "${input.projectTitle}" has been created and is awaiting escrow funding.`;
  const notifications = [
    {
      userId: input.clientUserId,
      type: "PROJECT" as const,
      title: input.marketplaceListing ? "Project posted to marketplace" : "Project created",
      body: clientBody,
      projectId: input.projectId,
      data: { event: "PROJECT_CREATED" },
    },
  ];

  if (input.freelancerUserId) {
    notifications.push({
      userId: input.freelancerUserId,
      type: "PROJECT" as const,
      title: "You were assigned to a project",
      body: `You have been assigned as freelancer on "${input.projectTitle}".`,
      projectId: input.projectId,
      data: { event: "PROJECT_CREATED" },
    });
  }

  await createNotifications(notifications);
}

export async function notifyProjectApplicationReceived(input: {
  projectId: string;
  projectTitle: string;
  clientUserId: string;
  /** Display name, wallet, or short label for the applicant. */
  applicantLabel: string;
}): Promise<void> {
  await createNotifications([
    {
      userId: input.clientUserId,
      type: "PROJECT",
      title: "New application",
      body: `${input.applicantLabel} applied to "${input.projectTitle}". Review their proposal in applications.`,
      projectId: input.projectId,
      data: { event: "PROJECT_APPLICATION_RECEIVED" },
    },
  ]);
}

export async function notifyProjectApplicationAccepted(input: {
  projectId: string;
  projectTitle: string;
  freelancerUserId: string;
}): Promise<void> {
  await createNotifications([
    {
      userId: input.freelancerUserId,
      type: "PROJECT",
      title: "Application accepted",
      body: `Your application for "${input.projectTitle}" was accepted. The project is awaiting escrow funding.`,
      projectId: input.projectId,
      data: { event: "PROJECT_APPLICATION_ACCEPTED" },
    },
  ]);
}

export type ProjectApplicationDeclinedReason = "CLIENT_DECLINED" | "OTHER_CANDIDATE_ACCEPTED";

const applicationDeclinedBody: Record<ProjectApplicationDeclinedReason, (title: string) => string> = {
  CLIENT_DECLINED: (title) =>
    `Your application for "${title}" was declined by the client.`,
  OTHER_CANDIDATE_ACCEPTED: (title) =>
    `Your application for "${title}" was not selected. Another applicant was accepted for this project.`,
};

/** One in-app notification per declined freelancer (explicit decline or bulk decline on accept). */
export async function notifyProjectApplicationsDeclined(input: {
  projectId: string;
  projectTitle: string;
  freelancerUserIds: string[];
  reason: ProjectApplicationDeclinedReason;
}): Promise<void> {
  const uniqueIds = [...new Set(input.freelancerUserIds)];
  if (!uniqueIds.length) {
    return;
  }
  const body = applicationDeclinedBody[input.reason](input.projectTitle);
  await createNotifications(
    uniqueIds.map((userId) => ({
      userId,
      type: "PROJECT" as const,
      title: "Application declined",
      body,
      projectId: input.projectId,
      data: { event: "PROJECT_APPLICATION_DECLINED", reason: input.reason },
    })),
  );
}

export async function notifyProjectFunded(input: {
  projectId: string;
  projectTitle: string;
  clientUserId: string;
  freelancerUserId: string | null;
}): Promise<void> {
  const notifications = [
    {
      userId: input.clientUserId,
      type: "PAYMENT" as const,
      title: "Project funded",
      body: `Escrow funding has been confirmed for "${input.projectTitle}".`,
      projectId: input.projectId,
      data: { event: "PROJECT_FUNDED" },
    },
  ];
  if (input.freelancerUserId) {
    notifications.push({
      userId: input.freelancerUserId,
      type: "PAYMENT" as const,
      title: "Project escrow funded",
      body: `Client escrow for "${input.projectTitle}" is funded. You can proceed with delivery.`,
      projectId: input.projectId,
      data: { event: "PROJECT_FUNDED" },
    });
  }
  await createNotifications(notifications);
}

export async function notifyMilestoneSubmitted(input: {
  projectId: string;
  milestoneId: string;
  milestoneTitle: string;
  clientUserId: string;
  freelancerUserId: string;
}): Promise<void> {
  await createNotifications([
    {
      userId: input.clientUserId,
      type: "SUBMISSION",
      title: "Milestone submitted",
      body: `New submission received for milestone "${input.milestoneTitle}".`,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      data: { event: "MILESTONE_SUBMITTED" },
    },
    {
      userId: input.freelancerUserId,
      type: "SUBMISSION",
      title: "Submission received",
      body: `Your submission for "${input.milestoneTitle}" is now awaiting client review.`,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      data: { event: "MILESTONE_SUBMITTED" },
    },
  ]);
}

export async function notifyMilestoneApproved(input: {
  projectId: string;
  milestoneId: string;
  milestoneTitle: string;
  clientUserId: string;
  freelancerUserId: string | null;
}): Promise<void> {
  const notifications = [
    {
      userId: input.clientUserId,
      type: "REVIEW" as const,
      title: "Milestone approved",
      body: `You approved milestone "${input.milestoneTitle}".`,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      data: { event: "MILESTONE_APPROVED" },
    },
  ];
  if (input.freelancerUserId) {
    notifications.push({
      userId: input.freelancerUserId,
      type: "REVIEW" as const,
      title: "Milestone approved",
      body: `Client approved your submission for "${input.milestoneTitle}".`,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      data: { event: "MILESTONE_APPROVED" },
    });
  }
  await createNotifications(notifications);
}

export async function notifyFundsReleased(input: {
  projectId: string;
  milestoneId: string;
  milestoneTitle: string;
  clientUserId: string;
  freelancerUserId: string | null;
}): Promise<void> {
  const notifications = [
    {
      userId: input.clientUserId,
      type: "PAYMENT" as const,
      title: "Funds released",
      body: `Milestone payout for "${input.milestoneTitle}" has been released.`,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      data: { event: "FUNDS_RELEASED" },
    },
  ];
  if (input.freelancerUserId) {
    notifications.push({
      userId: input.freelancerUserId,
      type: "PAYMENT" as const,
      title: "Payout received",
      body: `Funds for milestone "${input.milestoneTitle}" have been released to you.`,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      data: { event: "FUNDS_RELEASED" },
    });
  }
  await createNotifications(notifications);
}

export async function notifyDisputeRaised(input: {
  projectId: string;
  milestoneId: string;
  milestoneTitle: string;
  openedByUserId: string;
  clientUserId: string;
  freelancerUserId: string | null;
  disputeId: string;
}): Promise<void> {
  const notifications: Array<{
    userId: string;
    type: "DISPUTE";
    title: string;
    body: string;
    projectId: string;
    milestoneId: string;
    data: Record<string, unknown>;
  }> = [];
  const recipients = new Set<string>(
    [input.clientUserId, input.freelancerUserId].filter((v): v is string => Boolean(v)),
  );
  recipients.forEach((userId) => {
    if (userId === input.openedByUserId) {
      notifications.push({
        userId,
        type: "DISPUTE",
        title: "Dispute raised",
        body: `You opened a dispute for milestone "${input.milestoneTitle}".`,
        projectId: input.projectId,
        milestoneId: input.milestoneId,
        data: { event: "DISPUTE_RAISED", disputeId: input.disputeId },
      });
    } else {
      notifications.push({
        userId,
        type: "DISPUTE",
        title: "Dispute raised on milestone",
        body: `A dispute has been raised for milestone "${input.milestoneTitle}".`,
        projectId: input.projectId,
        milestoneId: input.milestoneId,
        data: { event: "DISPUTE_RAISED", disputeId: input.disputeId },
      });
    }
  });

  const admins = await prisma.userPlatformRole.findMany({
    where: { role: PlatformRole.ADMIN },
    select: { userId: true },
  });
  admins.forEach((admin) => {
    notifications.push({
      userId: admin.userId,
      type: "DISPUTE",
      title: "New dispute in admin queue",
      body: `Milestone "${input.milestoneTitle}" requires admin arbitration.`,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      data: { event: "DISPUTE_RAISED", disputeId: input.disputeId, adminQueue: true },
    });
  });

  await createNotifications(notifications);
}

export async function notifyDisputeResolved(input: {
  projectId: string;
  milestoneId: string;
  milestoneTitle: string;
  clientUserId: string;
  freelancerUserId: string | null;
  disputeId: string;
  outcome: "RESOLVED_CLIENT_FAVOR" | "RESOLVED_FREELANCER_FAVOR" | "RESOLVED_SPLIT";
}): Promise<void> {
  const bodyByOutcome = {
    RESOLVED_CLIENT_FAVOR: "Resolution completed in favor of client refund.",
    RESOLVED_FREELANCER_FAVOR: "Resolution completed in favor of freelancer payout.",
    RESOLVED_SPLIT: "Resolution completed with split outcome.",
  };
  const recipients = [input.clientUserId, input.freelancerUserId].filter(
    (v): v is string => Boolean(v),
  );
  await createNotifications(
    recipients.map((userId) => ({
      userId,
      type: "DISPUTE" as const,
      title: "Dispute resolved",
      body: `${bodyByOutcome[input.outcome]} Milestone "${input.milestoneTitle}".`,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      data: { event: "DISPUTE_RESOLVED", disputeId: input.disputeId, outcome: input.outcome },
    })),
  );
}
