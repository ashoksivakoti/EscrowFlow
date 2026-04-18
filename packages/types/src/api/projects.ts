import type {
  EntityId,
  IpfsUri,
  IsoDateTimeString,
  WeiAmount,
  WalletAddress,
} from "../primitives";
import type { ProjectStatus } from "../enums";
import type { CursorPageQuery, ListSortQuery } from "../pagination";
import type { ProjectDetail, ProjectSummary } from "../views/project";

export type ListProjectsQuery = CursorPageQuery &
  ListSortQuery & {
    query?: string;
    status?: ProjectStatus | ProjectStatus[];
    /** Projects where caller is client, freelancer, or either. */
    participation?: "client" | "freelancer" | "any";
  };

export type ListProjectsResponse = {
  items: ProjectSummary[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateProjectRequest = {
  title: string;
  description?: string | null;
  freelancerWalletAddress: WalletAddress;
  milestones: CreateProjectMilestoneInput[];
  agreement?: CreateProjectAgreementInput | null;
  agreementIpfsUri?: IpfsUri | null;
  chainId?: number | null;
  escrowContractAddress?: WalletAddress | null;
  onChainProjectId?: string | null;
  paymentTokenAddress?: WalletAddress | null;
};

export type CreateProjectMilestoneInput = {
  title: string;
  description?: string | null;
  amountWei: WeiAmount;
  dueAt: IsoDateTimeString;
};

export type CreateProjectAgreementInput =
  | {
      mode: "metadata";
      metadata: Record<string, unknown>;
    }
  | {
      mode: "file";
      fileName: string;
      mimeType: string;
      fileBase64: string;
    };

export type CreateProjectResponse = {
  project: ProjectDetail;
};

export type GetProjectResponse = {
  project: ProjectDetail;
};

export type UpdateProjectRequest = {
  title?: string;
  description?: string | null;
  status?: ProjectStatus;
  agreementIpfsUri?: IpfsUri | null;
  chainId?: number | null;
  escrowContractAddress?: WalletAddress | null;
  onChainProjectId?: string | null;
  paymentTokenAddress?: WalletAddress | null;
  totalValueWei?: WeiAmount | null;
  completedAt?: IsoDateTimeString | null;
  cancelledAt?: IsoDateTimeString | null;
};

export type UpdateProjectResponse = {
  project: ProjectDetail;
};

export type AssignFreelancerRequest = {
  freelancerUserId: EntityId;
};

export type AssignFreelancerResponse = {
  project: ProjectDetail;
};
