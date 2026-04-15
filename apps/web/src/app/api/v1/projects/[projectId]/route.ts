import type { NextResponse } from "next/server";

import { handleGetProject } from "@/server/route-handlers/v1/projects/detail";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const { projectId } = await params;
  return handleGetProject(request, projectId);
}
