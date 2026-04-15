import type { NextResponse } from "next/server";

import { handleCreateMilestoneSubmission } from "@/server/route-handlers/v1/submissions/create";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; milestoneId: string }> },
): Promise<NextResponse> {
  const { projectId, milestoneId } = await params;
  return handleCreateMilestoneSubmission(request, projectId, milestoneId);
}
