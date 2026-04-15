import type {
  EntityId,
  IpfsUri,
  IsoDateTimeString,
  WeiAmount,
  WalletAddress,
} from "../primitives.js";
import type { ProjectStatus } from "../enums.js";
import type { UserPublicRef } from "../profile.js";
import type { MilestoneSummary } from "./milestone.js";

export type ProjectSummary = {
  id: EntityId;
  status: ProjectStatus;
  title: string;
  chainId: number | null;
  escrowContractAddress: WalletAddress | null;
  onChainProjectId: string | null;
  paymentTokenAddress: WalletAddress | null;
  totalValueWei: WeiAmount | null;
  client: UserPublicRef;
  freelancer: UserPublicRef | null;
  agreementIpfsUri: IpfsUri | null;
  milestoneCount: number;
  milestonesReleasedCount?: number;
  nextMilestoneDueAt?: IsoDateTimeString | null;
  openDisputeCount: number;
  updatedAt: IsoDateTimeString;
};

export type ProjectDetail = ProjectSummary & {
  description: string | null;
  milestones: MilestoneSummary[];
  completedAt: IsoDateTimeString | null;
  cancelledAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
};
