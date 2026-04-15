import type {
  EntityId,
  IpfsUri,
  IsoDateTimeString,
  TxHash,
} from "../primitives.js";
import type { DisputeStatus } from "../enums.js";
import type { UserPublicRef } from "../profile.js";

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
