import type { NextResponse } from "next/server";

import { handleDeclineApplication } from "@/server/route-handlers/v1/projects/application-decline";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; applicationId: string }> },
): Promise<NextResponse> {
  const { projectId, applicationId } = await params;
  return handleDeclineApplication(request, projectId, applicationId);
}
