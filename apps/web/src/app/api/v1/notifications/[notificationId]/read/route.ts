import type { NextResponse } from "next/server";

import { handleMarkNotificationRead } from "@/server/route-handlers/v1/notifications/read";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> },
): Promise<NextResponse> {
  const { notificationId } = await params;
  return handleMarkNotificationRead(request, notificationId);
}
