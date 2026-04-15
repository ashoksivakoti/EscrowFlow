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
import type { IpfsFileRef } from "../ipfs.js";

export type ProjectSubmissionPreview = {
  id: EntityId;
  milestoneId: EntityId;
  status: string;
  summary: string | null;
  note?: string | null;
  reviewNote?: string | null;
  metadataIpfsUri?: IpfsUri | null;
  externalLink?: string | null;
  deliverableFiles?: IpfsFileRef[];
  submittedAt: IsoDateTimeString | null;
  decidedAt?: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
};

export type ProjectDisputePreview = {
  id: EntityId;
  milestoneId: EntityId;
  status: string;
  title: string | null;
  description: string;
  evidenceIpfsUri: IpfsUri;
  createdAt: IsoDateTimeString;
  resolvedAt: IsoDateTimeString | null;
};

export type ProjectTransactionHistoryItem = {
  chainId?: number | null;
  txHash: string;
  blockNumber: string;
  logIndex: number;
  eventName: string;
  fromAddress: WalletAddress | null;
  toAddress: WalletAddress | null;
  amountWei?: WeiAmount | null;
  createdAt: IsoDateTimeString;
  blockTimestamp: IsoDateTimeString | null;
};

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
  fundedAmountWei: WeiAmount;
  releasedAmountWei: WeiAmount;
  agreementLinks: IpfsUri[];
  latestSubmission: ProjectSubmissionPreview | null;
  openDispute: ProjectDisputePreview | null;
  recentTransactions: ProjectTransactionHistoryItem[];
  milestones: MilestoneSummary[];
  completedAt: IsoDateTimeString | null;
  cancelledAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
};
