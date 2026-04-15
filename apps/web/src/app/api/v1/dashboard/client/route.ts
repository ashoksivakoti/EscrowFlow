import type { NextResponse } from "next/server";

import { handleGetClientDashboard } from "@/server/route-handlers/v1/dashboard/client";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleGetClientDashboard(request);
}
