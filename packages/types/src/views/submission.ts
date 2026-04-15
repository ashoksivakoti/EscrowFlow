import type { EntityId, IpfsUri, IsoDateTimeString } from "../primitives.js";
import type { SubmissionStatus } from "../enums.js";
import type { UserPublicRef } from "../profile.js";

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
  updatedAt: IsoDateTimeString;
};
