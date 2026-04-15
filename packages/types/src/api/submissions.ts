import type { IpfsUri, IsoDateTimeString } from "../primitives.js";
import type { SubmissionStatus } from "../enums.js";
import type { CursorPageQuery } from "../pagination.js";
import type {
  SubmissionDetail,
  SubmissionListItem,
} from "../views/submission.js";

export type ListSubmissionsQuery = CursorPageQuery & {
  status?: SubmissionStatus | SubmissionStatus[];
};

export type ListSubmissionsResponse = {
  items: SubmissionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateSubmissionRequest = {
  deliverablesIpfsUri: IpfsUri;
  summary?: string | null;
  /** If true, server moves prior active attempt to SUPERSEDED. */
  submit?: boolean;
};

export type CreateSubmissionResponse = {
  submission: SubmissionDetail;
};

export type GetSubmissionResponse = {
  submission: SubmissionDetail;
};

export type UpdateSubmissionRequest = {
  status?: SubmissionStatus;
  summary?: string | null;
  deliverablesIpfsUri?: IpfsUri | null;
  submittedAt?: IsoDateTimeString | null;
  decidedAt?: IsoDateTimeString | null;
};

export type UpdateSubmissionResponse = {
  submission: SubmissionDetail;
};
