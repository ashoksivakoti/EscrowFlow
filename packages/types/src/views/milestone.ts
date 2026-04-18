import type {
  EntityId,
  IpfsUri,
  IsoDateTimeString,
  WeiAmount,
} from "../primitives";
import type { MilestoneStatus } from "../enums";
import type { SubmissionListItem } from "./submission";
import type { DisputeListItem } from "./dispute";

export type MilestoneSummary = {
  id: EntityId;
  projectId: EntityId;
  sortOrder: number;
  title: string;
  status: MilestoneStatus;
  amountWei: WeiAmount;
  dueAt: IsoDateTimeString | null;
  specificationIpfsUri: IpfsUri | null;
  fundedAt: IsoDateTimeString | null;
  releasedAt: IsoDateTimeString | null;
  updatedAt: IsoDateTimeString;
  latestSubmissionId: EntityId | null;
  openDisputeId: EntityId | null;
};

export type MilestoneDetail = MilestoneSummary & {
  description: string | null;
  submissions: SubmissionListItem[];
  disputes: DisputeListItem[];
  createdAt: IsoDateTimeString;
};
