import type { NextResponse } from "next/server";

import { handleListPublicProjects } from "@/server/route-handlers/v1/projects/public-list";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleListPublicProjects(request);
}
