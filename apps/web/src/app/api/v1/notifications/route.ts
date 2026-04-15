import type { NextResponse } from "next/server";

import { handleListNotifications } from "@/server/route-handlers/v1/notifications/list";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleListNotifications(request);
}
