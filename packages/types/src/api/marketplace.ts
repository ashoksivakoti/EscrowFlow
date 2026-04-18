import type { EntityId, IsoDateTimeString, WeiAmount } from "../primitives";
import type { ProjectApplicationStatus, ProjectStatus, ProjectVisibility } from "../enums";
import type { UserPublicRef } from "../profile";
import type {
  CreateProjectAgreementInput,
  CreateProjectMilestoneInput,
} from "./projects";
import type { ProjectDetail } from "../views/project";

export type PublicProjectMilestonePreview = {
  id: EntityId;
  title: string;
  amountWei: WeiAmount;
  dueAt: IsoDateTimeString | null;
};

export type PublicProjectSummary = {
  id: EntityId;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  title: string;
  description: string | null;
  totalValueWei: WeiAmount | null;
  milestoneCount: number;
  client: UserPublicRef;
  updatedAt: IsoDateTimeString;
};

export type PublicProjectDetail = PublicProjectSummary & {
  milestones: PublicProjectMilestonePreview[];
};

export type ListPublicProjectsQuery = {
  query?: string;
  sortBy?: "updatedAt" | "createdAt";
  sortOrder?: "asc" | "desc";
  limit?: number;
  cursor?: string | null;
};

export type ListPublicProjectsResponse = {
  items: PublicProjectSummary[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type GetPublicProjectResponse = {
  project: PublicProjectDetail;
  /** When authenticated: caller's latest application status for this project, if any. */
  myApplicationStatus: ProjectApplicationStatus | null;
};

export type CreateMarketplaceProjectRequest = {
  title: string;
  description?: string | null;
  milestones: CreateProjectMilestoneInput[];
  agreement?: CreateProjectAgreementInput | null;
  chainId?: number | null;
  escrowContractAddress?: string | null;
  onChainProjectId?: string | null;
  paymentTokenAddress?: string | null;
};

export type CreateMarketplaceProjectResponse = {
  project: ProjectDetail;
};

export type ProjectApplicationDto = {
  id: EntityId;
  projectId: EntityId;
  freelancer: UserPublicRef;
  coverLetter: string;
  portfolioLink: string | null;
  proposedTimeline: string | null;
  status: ProjectApplicationStatus;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
};

export type ListProjectApplicationsResponse = {
  applications: ProjectApplicationDto[];
};

export type CreateProjectApplicationRequest = {
  coverLetter: string;
  /** Required when applying; stored on the application record. */
  portfolioLink: string;
  proposedTimeline?: string | null;
};

export type CreateProjectApplicationResponse = {
  application: ProjectApplicationDto;
};
