export type {
  IsoDateTimeString,
  IsoDateString,
  WalletAddress,
  IpfsUri,
  WeiAmount,
  TxHash,
  EntityId,
} from "./primitives";

export {
  PLATFORM_ROLES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITIES,
  PROJECT_APPLICATION_STATUSES,
  MILESTONE_STATUSES,
  SUBMISSION_STATUSES,
  DISPUTE_STATUSES,
  NOTIFICATION_TYPES,
} from "./enums";
export type {
  PlatformRole,
  ProjectStatus,
  ProjectVisibility,
  ProjectApplicationStatus,
  MilestoneStatus,
  SubmissionStatus,
  DisputeStatus,
  NotificationType,
} from "./enums";

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
} from "./pagination";

export type {
  ApiErrorBody,
  ApiSuccessEnvelope,
  ApiErrorEnvelope,
} from "./api-error";

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
} from "./ipfs";

export type {
  AuthNonceResponse,
  SiweVerifyRequest,
  SessionToken,
  SessionUser,
  SessionResponse,
  SessionClaims,
  GetSessionResponse,
} from "./auth";

export type {
  UserPublicRef,
  ProfilePublic,
  ProfilePrivate,
  UpdateProfileRequest,
  UserWithRoles,
} from "./profile";

export type { LogoutResponse } from "./api/auth";

export type {
  ProjectSummary,
  ProjectDetail,
  ProjectSubmissionPreview,
  ProjectDisputePreview,
  ProjectTransactionHistoryItem,
} from "./views/project";
export type { MilestoneSummary, MilestoneDetail } from "./views/milestone";
export type {
  SubmissionListItem,
  SubmissionDetail,
} from "./views/submission";
export type {
  DisputeListItem,
  DisputeDetail,
  AdminDisputeDetail,
  AdminDisputeResolutionKind,
} from "./views/dispute";
export type { NotificationListItem } from "./views/notification";
export type { ReviewListItem } from "./views/review";
export type {
  DashboardActionKind,
  DashboardActionItem,
  DashboardSummaryMetrics,
  DashboardRecentTransaction,
  ClientDashboard,
  FreelancerDashboard,
  AdminDashboard,
  DashboardPayload,
} from "./views/dashboard";

export type {
  GetMeResponse,
  UpdateMeProfileRequest,
  UpdateMeProfileResponse,
  GetUserPublicResponse,
} from "./api/users";

export type {
  CompleteOnboardingRequest,
  CompleteOnboardingResponse,
} from "./api/onboarding";

export type {
  ListProjectsQuery,
  ListProjectsResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
  ConfirmProjectOnChainBindingRequest,
  ConfirmProjectOnChainBindingResponse,
  UpdateProjectRequest,
  UpdateProjectResponse,
  AssignFreelancerRequest,
  AssignFreelancerResponse,
} from "./api/projects";

export type {
  PublicProjectMilestonePreview,
  PublicProjectSummary,
  PublicProjectDetail,
  ListPublicProjectsQuery,
  ListPublicProjectsResponse,
  GetPublicProjectResponse,
  CreateMarketplaceProjectRequest,
  CreateMarketplaceProjectResponse,
  ProjectApplicationDto,
  ListProjectApplicationsResponse,
  CreateProjectApplicationRequest,
  CreateProjectApplicationResponse,
} from "./api/marketplace";

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
} from "./api/milestones";

export type {
  ListSubmissionsQuery,
  ListSubmissionsResponse,
  CreateSubmissionRequest,
  CreateSubmissionResponse,
  GetSubmissionResponse,
  UpdateSubmissionRequest,
  UpdateSubmissionResponse,
} from "./api/submissions";

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
} from "./api/disputes";

export type {
  ListNotificationsQuery,
  ListNotificationsResponse,
  MarkNotificationReadResponse,
  MarkAllNotificationsReadRequest,
  MarkAllNotificationsReadResponse,
  DeleteNotificationResponse,
} from "./api/notifications";

export type {
  ListReviewsQuery,
  ListReviewsResponse,
  CreateReviewRequest,
  CreateReviewResponse,
} from "./api/reviews";

export type {
  GetDashboardQuery,
  GetDashboardResponse,
  GetClientDashboardResponse,
  GetFreelancerDashboardResponse,
} from "./api/dashboard";
