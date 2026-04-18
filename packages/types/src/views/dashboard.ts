import type { EntityId, IsoDateTimeString } from "../primitives";
import type { NotificationListItem } from "./notification";
import type { ProjectSummary } from "./project";

export type DashboardActionKind =
  | "MILESTONE_CLIENT_REVIEW"
  | "MILESTONE_DELIVERY_DUE"
  | "MILESTONE_AWAITING_FUNDS"
  | "SUBMISSION_RECEIVED"
  | "DISPUTE_OPEN"
  | "DISPUTE_ADMIN_QUEUE"
  | "PROJECT_AWAITING_ESCROW"
  | "REVIEW_PENDING";

export type DashboardActionItem = {
  kind: DashboardActionKind;
  title: string;
  /** Deep link path or route name — resolved by the client router. */
  href: string;
  projectId: EntityId;
  milestoneId?: EntityId;
  submissionId?: EntityId;
  disputeId?: EntityId;
  dueAt?: IsoDateTimeString;
  priority?: "low" | "medium" | "high";
};

export type DashboardSummaryMetrics = {
  activeProjectsCount: number;
  pendingActionsCount: number;
  unreadNotificationsCount: number;
};

export type DashboardRecentTransaction = {
  chainId?: number | null;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  eventName: string;
  projectId: EntityId | null;
  milestoneId: EntityId | null;
  amountWei?: string | null;
  createdAt: IsoDateTimeString;
  blockTimestamp: IsoDateTimeString | null;
};

export type ClientDashboard = {
  role: "CLIENT";
  summary: DashboardSummaryMetrics & {
    awaitingEscrowCount: number;
    totalTrackedProjectCount: number;
    totalEscrowLockedWei: string;
    pendingMilestoneReviewsCount: number;
    openDisputesCount: number;
    completedProjectsCount: number;
  };
  recentProjects: ProjectSummary[];
  activeProjects: ProjectSummary[];
  awaitingFreelancer: ProjectSummary[];
  awaitingEscrow: ProjectSummary[];
  actions: DashboardActionItem[];
  recentTransactions: DashboardRecentTransaction[];
  notifications: NotificationListItem[];
};

export type FreelancerDashboard = {
  role: "FREELANCER";
  summary: DashboardSummaryMetrics & {
    milestonesToDeliverCount: number;
    underReviewMilestonesCount: number;
    pendingSubmissionsCount: number;
    pendingReviewsCount: number;
    openDisputesCount: number;
    releasedEarningsWei: string;
  };
  activeProjects: ProjectSummary[];
  milestonesToDeliver: DashboardActionItem[];
  actions: DashboardActionItem[];
  recentTransactions: DashboardRecentTransaction[];
  notifications: NotificationListItem[];
};

export type AdminDashboard = {
  role: "ADMIN";
  openDisputesCount: number;
  disputesQueue: DashboardActionItem[];
  recentProjects: ProjectSummary[];
  notifications: NotificationListItem[];
};

export type DashboardPayload =
  | ClientDashboard
  | FreelancerDashboard
  | AdminDashboard;
