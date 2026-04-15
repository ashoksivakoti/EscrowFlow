import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import {
  markAllNotificationsReadForUser,
  markNotificationReadForUser,
} from "@/server/services/notification-service";

export async function handleMarkNotificationRead(
  request: Request,
  notificationId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.notifications.read.post", async () => {
    const auth = await requireAuthenticated(request);
    const response = await markNotificationReadForUser(auth.userId, notificationId);
    return NextResponse.json(response);
  });
}

export async function handleMarkAllNotificationsRead(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.notifications.readAll.post", async () => {
    const auth = await requireAuthenticated(request);
    const response = await markAllNotificationsReadForUser(auth.userId);
    return NextResponse.json(response);
  });
}
