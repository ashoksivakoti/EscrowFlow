import type {
  EntityId,
  IpfsUri,
  IsoDateTimeString,
  TxHash,
} from "../primitives";
import type { DisputeStatus } from "../enums";
import type { UserPublicRef } from "../profile";
import type { ProjectTransactionHistoryItem } from "./project";

export type DisputeListItem = {
  id: EntityId;
  milestoneId: EntityId;
  status: DisputeStatus;
  title: string | null;
  evidenceIpfsUri: IpfsUri;
  openedBy: UserPublicRef;
  relatedSubmissionId: EntityId | null;
  resolvedAt: IsoDateTimeString | null;
  resolutionTxHash: TxHash | null;
  createdAt: IsoDateTimeString;
};

export type DisputeDetail = DisputeListItem & {
  description: string;
  resolvedBy: UserPublicRef | null;
  updatedAt: IsoDateTimeString;
};

export type AdminDisputeResolutionKind =
  | "PAYOUT_TO_FREELANCER"
  | "REFUND_TO_CLIENT"
  | "SPLIT";

export type AdminDisputeDetail = DisputeDetail & {
  project: {
    id: EntityId;
    title: string;
    status: string;
    chainId: number | null;
    escrowContractAddress: string | null;
    onChainProjectId: string | null;
    paymentTokenAddress: string | null;
    totalValueWei: string | null;
    fundedAmountWei: string;
    releasedAmountWei: string;
  };
  milestone: {
    id: EntityId;
    sortOrder: number;
    title: string;
    status: string;
    amountWei: string;
    dueAt: IsoDateTimeString | null;
    latestSubmissionId: EntityId | null;
  };
  participants: {
    client: UserPublicRef;
    freelancer: UserPublicRef | null;
  };
  relatedSubmission: {
    id: EntityId;
    status: string;
    submittedAt: IsoDateTimeString | null;
    note: string | null;
  } | null;
  evidenceLinks: IpfsUri[];
  resolution: {
    kind: AdminDisputeResolutionKind | null;
    freelancerAmountWei: string | null;
    clientAmountWei: string | null;
    note: string | null;
  } | null;
  emergencyResolutionProposal: {
    status: "proposed" | "cancelled" | "executed" | "invalidated";
    actionHash: string | null;
    kind: number | null;
    freelancerAmountWei: string | null;
    clientAmountWei: string | null;
    readyAt: IsoDateTimeString | null;
    txHash: TxHash;
    logIndex: number;
    updatedAt: IsoDateTimeString;
  } | null;
  recentTransactions: ProjectTransactionHistoryItem[];
};
