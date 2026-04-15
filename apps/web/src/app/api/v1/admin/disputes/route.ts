import type { NextResponse } from "next/server";

import { handleListAdminDisputes } from "@/server/route-handlers/v1/admin/disputes/list";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleListAdminDisputes(request);
}
