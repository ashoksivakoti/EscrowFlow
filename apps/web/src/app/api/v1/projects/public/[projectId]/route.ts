import type { NextResponse } from "next/server";

import { handleGetPublicProject } from "@/server/route-handlers/v1/projects/public-detail";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const { projectId } = await params;
  return handleGetPublicProject(request, projectId);
}
