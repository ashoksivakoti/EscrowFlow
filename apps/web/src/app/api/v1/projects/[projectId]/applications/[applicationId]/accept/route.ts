import type { NextResponse } from "next/server";

import { handleAcceptApplication } from "@/server/route-handlers/v1/projects/application-accept";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; applicationId: string }> },
): Promise<NextResponse> {
  const { projectId, applicationId } = await params;
  return handleAcceptApplication(request, projectId, applicationId);
}
