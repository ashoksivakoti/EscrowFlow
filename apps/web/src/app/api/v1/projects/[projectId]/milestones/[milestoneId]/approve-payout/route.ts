import type { NextResponse } from "next/server";

import { handleApproveMilestoneAndPayout } from "@/server/route-handlers/v1/milestones/approve-payout";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; milestoneId: string }> },
): Promise<NextResponse> {
  const { projectId, milestoneId } = await params;
  return handleApproveMilestoneAndPayout(request, projectId, milestoneId);
}
