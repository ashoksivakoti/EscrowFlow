import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { listNotificationsForUser } from "@/server/services/notification-service";
import { parseWithSchema } from "@/server/validation/parse";
import { listNotificationsQuerySchema } from "@/server/validation/schemas/notifications";

export async function handleListNotifications(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.notifications.list.get", async () => {
    const auth = await requireAuthenticated(request);
    const url = new URL(request.url);
    const query = parseWithSchema(
      {
        limit: url.searchParams.get("limit") ?? undefined,
        unreadOnly: url.searchParams.get("unreadOnly") ?? undefined,
      },
      listNotificationsQuerySchema,
    );

    const response = await listNotificationsForUser({
      userId: auth.userId,
      limit: query.limit,
      unreadOnly: query.unreadOnly,
    });
    return NextResponse.json(response);
  });
}
