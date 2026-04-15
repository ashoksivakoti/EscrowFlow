import type {
  EntityId,
  IpfsUri,
  IsoDateTimeString,
  WeiAmount,
} from "../primitives.js";
import type { MilestoneStatus } from "../enums.js";
import type { CursorPageQuery } from "../pagination.js";
import type { MilestoneDetail, MilestoneSummary } from "../views/milestone.js";

export type ListMilestonesQuery = CursorPageQuery & {
  status?: MilestoneStatus | MilestoneStatus[];
};

export type ListMilestonesResponse = {
  items: MilestoneSummary[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateMilestoneRequest = {
  title: string;
  description?: string | null;
  amountWei: WeiAmount;
  dueAt?: IsoDateTimeString | null;
  specificationIpfsUri?: IpfsUri | null;
  /** If omitted, server appends to end. */
  sortOrder?: number;
};

export type CreateMilestoneResponse = {
  milestone: MilestoneDetail;
};

export type GetMilestoneResponse = {
  milestone: MilestoneDetail;
};

export type UpdateMilestoneRequest = {
  title?: string;
  description?: string | null;
  amountWei?: WeiAmount;
  status?: MilestoneStatus;
  dueAt?: IsoDateTimeString | null;
  specificationIpfsUri?: IpfsUri | null;
  sortOrder?: number;
  fundedAt?: IsoDateTimeString | null;
  releasedAt?: IsoDateTimeString | null;
};

export type UpdateMilestoneResponse = {
  milestone: MilestoneDetail;
};

export type ReorderMilestonesRequest = {
  orderedIds: EntityId[];
};

export type ReorderMilestonesResponse = {
  milestones: MilestoneSummary[];
};
