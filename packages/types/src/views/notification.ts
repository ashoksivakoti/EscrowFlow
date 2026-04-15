import type { EntityId, IsoDateTimeString } from "../primitives.js";
import type { NotificationType } from "../enums.js";

export type NotificationListItem = {
  id: EntityId;
  type: NotificationType;
  title: string;
  body: string;
  readAt: IsoDateTimeString | null;
  projectId: EntityId | null;
  milestoneId: EntityId | null;
  data: Record<string, unknown> | null;
  createdAt: IsoDateTimeString;
};
