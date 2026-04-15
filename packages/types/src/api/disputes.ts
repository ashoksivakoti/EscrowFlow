import type { EntityId, IpfsUri, TxHash } from "../primitives.js";
import type { DisputeStatus } from "../enums.js";
import type { CursorPageQuery } from "../pagination.js";
import type { DisputeDetail, DisputeListItem } from "../views/dispute.js";

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
  description: string;
  evidenceIpfsUri: IpfsUri;
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
