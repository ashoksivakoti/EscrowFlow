import type { NextResponse } from "next/server";

import { handleMarkAllNotificationsRead } from "@/server/route-handlers/v1/notifications/read";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  return handleMarkAllNotificationsRead(request);
}
