import { Prisma, type NotificationType } from "@prisma/client";

import type {
  ListNotificationsResponse,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationListItem,
} from "@escrowflow/types";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors/app-error";

type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  projectId?: string | null;
  milestoneId?: string | null;
  data?: Record<string, unknown> | null;
};

export async function createNotifications(inputs: CreateNotificationInput[]): Promise<void> {
  if (!inputs.length) {
    return;
  }

  await prisma.notification.createMany({
    data: inputs.map((input) => ({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      projectId: input.projectId ?? null,
      milestoneId: input.milestoneId ?? null,
      data: input.data
        ? (input.data as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    })),
  });
}

export async function listNotificationsForUser(input: {
  userId: string;
  limit?: number;
  unreadOnly?: boolean;
}): Promise<ListNotificationsResponse & { unreadCount: number }> {
  const limit = input.limit ?? 12;
  const where = {
    userId: input.userId,
    ...(input.unreadOnly ? { readAt: null } : {}),
  };

  const [rows, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({
      where: { userId: input.userId, readAt: null },
    }),
  ]);

  return {
    items: rows.map(mapNotification),
    nextCursor: null,
    hasMore: false,
    unreadCount,
  };
}

export async function markNotificationReadForUser(
  userId: string,
  notificationId: string,
): Promise<MarkNotificationReadResponse> {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!notification) {
    throw AppError.notFound("NOTIFICATION_NOT_FOUND", "Notification not found");
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      readAt: notification.readAt ?? new Date(),
    },
  });

  return { notification: mapNotification(updated) };
}

export async function markAllNotificationsReadForUser(
  userId: string,
): Promise<MarkAllNotificationsReadResponse> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updatedCount: result.count };
}

function mapNotification(notification: {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  projectId: string | null;
  milestoneId: string | null;
  data: Prisma.JsonValue;
  createdAt: Date;
}): NotificationListItem {
  const data =
    notification.data &&
    typeof notification.data === "object" &&
    !Array.isArray(notification.data)
      ? (notification.data as Record<string, unknown>)
      : null;

  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt?.toISOString() ?? null,
    projectId: notification.projectId,
    milestoneId: notification.milestoneId,
    data,
    createdAt: notification.createdAt.toISOString(),
  };
}
