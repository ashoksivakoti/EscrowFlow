import type { EntityId } from "../primitives.js";
import type { NotificationType } from "../enums.js";
import type { CursorPageQuery, TimeRangeQuery } from "../pagination.js";
import type { NotificationListItem } from "../views/notification.js";

export type ListNotificationsQuery = CursorPageQuery &
  TimeRangeQuery & {
    type?: NotificationType | NotificationType[];
    unreadOnly?: boolean;
  };

export type ListNotificationsResponse = {
  items: NotificationListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount?: number;
};

export type MarkNotificationReadResponse = {
  notification: NotificationListItem;
};

export type MarkAllNotificationsReadRequest = {
  before?: string | null;
};

export type MarkAllNotificationsReadResponse = {
  updatedCount: number;
};

export type DeleteNotificationResponse = {
  id: EntityId;
  deleted: true;
};
