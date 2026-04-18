import type { EntityId, IpfsUri, TxHash } from "../primitives";
import type { DisputeStatus } from "../enums";
import type { CursorPageQuery } from "../pagination";
import type {
  AdminDisputeDetail,
  DisputeDetail,
  DisputeListItem,
} from "../views/dispute";

export type ListDisputesQuery = CursorPageQuery & {
  status?: DisputeStatus | DisputeStatus[];
};

export type ListDisputesResponse = {
  items: DisputeListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateDisputeRequest = {
  title?: string | null;
  /** Human-readable reason shown in participant and admin review UIs. */
  reason: string;
  /** Optional legacy alias retained for older clients. */
  description?: string;
  /**
   * Optional legacy direct IPFS URI. New clients should upload evidence files and let the server
   * generate dispute evidence metadata URI.
   */
  evidenceIpfsUri?: IpfsUri;
  files?: Array<{
    fileName: string;
    mimeType: string;
    fileBase64: string;
  }>;
  relatedSubmissionId?: EntityId | null;
};

export type CreateDisputeResponse = {
  dispute: DisputeDetail;
};

export type GetDisputeResponse = {
  dispute: DisputeDetail;
};

export type UpdateDisputeRequest = {
  status?: DisputeStatus;
  /** Admin-only in implementation; typed for contract completeness. */
  internalNotes?: string | null;
  resolutionTxHash?: TxHash | null;
};

export type UpdateDisputeResponse = {
  dispute: DisputeDetail;
};

export type ListAdminDisputesQuery = {
  status?: "open" | "resolved" | "all";
  limit?: number;
};

export type ListAdminDisputesResponse = {
  items: AdminDisputeDetail[];
};

export type ResolveDisputeRequest = {
  kind: "PAYOUT_TO_FREELANCER" | "REFUND_TO_CLIENT" | "SPLIT";
  freelancerAmountWei: string;
  clientAmountWei: string;
  resolutionNote?: string | null;
  chainId?: number;
  escrowContractAddress?: string;
  onChainProjectId?: string;
  milestoneIndex?: number;
  resolutionTxHash?: TxHash | null;
};

export type ResolveDisputeResponse = {
  dispute: AdminDisputeDetail;
};
