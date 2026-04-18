import type { EntityId, IsoDateTimeString } from "../primitives";
import type { NotificationType } from "../enums";

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
