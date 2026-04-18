import type { EntityId, IpfsUri, IsoDateTimeString } from "../primitives";
import type { SubmissionStatus } from "../enums";
import type { UserPublicRef } from "../profile";
import type { IpfsFileRef } from "../ipfs";

export type SubmissionListItem = {
  id: EntityId;
  milestoneId: EntityId;
  status: SubmissionStatus;
  attemptNumber: number;
  deliverablesIpfsUri: IpfsUri;
  summary: string | null;
  submittedBy: UserPublicRef;
  submittedAt: IsoDateTimeString | null;
  decidedAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
};

export type SubmissionDetail = SubmissionListItem & {
  note?: string | null;
  externalLink?: string | null;
  metadataIpfsUri?: IpfsUri | null;
  deliverableFiles?: IpfsFileRef[];
  updatedAt: IsoDateTimeString;
};
