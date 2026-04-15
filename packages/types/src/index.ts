export type {
  IsoDateTimeString,
  IsoDateString,
  WalletAddress,
  IpfsUri,
  WeiAmount,
  TxHash,
  EntityId,
} from "./primitives.js";

export {
  PLATFORM_ROLES,
  PROJECT_STATUSES,
  MILESTONE_STATUSES,
  SUBMISSION_STATUSES,
  DISPUTE_STATUSES,
  NOTIFICATION_TYPES,
} from "./enums.js";
export type {
  PlatformRole,
  ProjectStatus,
  MilestoneStatus,
  SubmissionStatus,
  DisputeStatus,
  NotificationType,
} from "./enums.js";

export type {
  SortOrder,
  CursorPageQuery,
  CursorPageMeta,
  CursorPageResponse,
  OffsetPageQuery,
  OffsetPageMeta,
  OffsetPageResponse,
  ListSortQuery,
  TimeRangeQuery,
} from "./pagination.js";

export type {
  ApiErrorBody,
  ApiSuccessEnvelope,
  ApiErrorEnvelope,
} from "./api-error.js";

export type {
  AgreementMetadata,
  DisputeEvidenceMetadata,
  IpfsFileRef,
  IpfsMetadataSchema,
  IpfsTypedMetadata,
  MilestoneSubmissionMetadata,
  ProjectAgreementMetadata,
  DeliverableFileRef,
  DeliverablesManifest,
  DisputeEvidenceManifest,
  IpfsJsonBase,
  IpfsObjectRef,
} from "./ipfs.js";

export type {
  AuthNonceResponse,
  SiweVerifyRequest,
  SessionToken,
  SessionUser,
  SessionResponse,
  SessionClaims,
  GetSessionResponse,
} from "./auth.js";

export type {
  UserPublicRef,
  ProfilePublic,
  ProfilePrivate,
  UpdateProfileRequest,
  UserWithRoles,
} from "./profile.js";

export type { LogoutResponse } from "./api/auth.js";

export type {
  ProjectSummary,
  ProjectDetail,
  ProjectSubmissionPreview,
  ProjectDisputePreview,
  ProjectTransactionHistoryItem,
} from "./views/project.js";
export type { MilestoneSummary, MilestoneDetail } from "./views/milestone.js";
export type {
  SubmissionListItem,
  SubmissionDetail,
} from "./views/submission.js";
export type {
  DisputeListItem,
  DisputeDetail,
  AdminDisputeDetail,
  AdminDisputeResolutionKind,
} from "./views/dispute.js";
export type { NotificationListItem } from "./views/notification.js";
export type { ReviewListItem } from "./views/review.js";
export type {
  DashboardActionKind,
  DashboardActionItem,
  DashboardSummaryMetrics,
  DashboardRecentTransaction,
  ClientDashboard,
  FreelancerDashboard,
  AdminDashboard,
  DashboardPayload,
} from "./views/dashboard.js";

export type {
  GetMeResponse,
  UpdateMeProfileRequest,
  UpdateMeProfileResponse,
  GetUserPublicResponse,
} from "./api/users.js";

export type {
  CompleteOnboardingRequest,
  CompleteOnboardingResponse,
} from "./api/onboarding.js";

export type {
  ListProjectsQuery,
  ListProjectsResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
  UpdateProjectRequest,
  UpdateProjectResponse,
  AssignFreelancerRequest,
  AssignFreelancerResponse,
} from "./api/projects.js";

export type {
  ListMilestonesQuery,
  ListMilestonesResponse,
  CreateMilestoneRequest,
  CreateMilestoneResponse,
  GetMilestoneResponse,
  UpdateMilestoneRequest,
  UpdateMilestoneResponse,
  ReorderMilestonesRequest,
  ReorderMilestonesResponse,
} from "./api/milestones.js";

export type {
  ListSubmissionsQuery,
  ListSubmissionsResponse,
  CreateSubmissionRequest,
  CreateSubmissionResponse,
  GetSubmissionResponse,
  UpdateSubmissionRequest,
  UpdateSubmissionResponse,
} from "./api/submissions.js";

export type {
  ListDisputesQuery,
  ListDisputesResponse,
  CreateDisputeRequest,
  CreateDisputeResponse,
  GetDisputeResponse,
  UpdateDisputeRequest,
  UpdateDisputeResponse,
  ListAdminDisputesQuery,
  ListAdminDisputesResponse,
  ResolveDisputeRequest,
  ResolveDisputeResponse,
} from "./api/disputes.js";

export type {
  ListNotificationsQuery,
  ListNotificationsResponse,
  MarkNotificationReadResponse,
  MarkAllNotificationsReadRequest,
  MarkAllNotificationsReadResponse,
  DeleteNotificationResponse,
} from "./api/notifications.js";

export type {
  ListReviewsQuery,
  ListReviewsResponse,
  CreateReviewRequest,
  CreateReviewResponse,
} from "./api/reviews.js";

export type {
  GetDashboardQuery,
  GetDashboardResponse,
  GetClientDashboardResponse,
  GetFreelancerDashboardResponse,
} from "./api/dashboard.js";
