import type { NextResponse } from "next/server";

import { handleCreateMilestoneDispute } from "@/server/route-handlers/v1/disputes/create";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; milestoneId: string }> },
): Promise<NextResponse> {
  const { projectId, milestoneId } = await params;
  return handleCreateMilestoneDispute(request, projectId, milestoneId);
}
