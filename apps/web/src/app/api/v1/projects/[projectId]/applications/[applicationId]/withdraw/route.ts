import type { NextResponse } from "next/server";

import { handleWithdrawApplication } from "@/server/route-handlers/v1/projects/application-withdraw";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; applicationId: string }> },
): Promise<NextResponse> {
  const { projectId, applicationId } = await params;
  return handleWithdrawApplication(request, projectId, applicationId);
}
