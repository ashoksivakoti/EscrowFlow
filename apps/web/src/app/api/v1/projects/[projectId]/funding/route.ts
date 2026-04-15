import type { NextResponse } from "next/server";

import { handleReconcileFunding } from "@/server/route-handlers/v1/projects/funding-reconcile";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const { projectId } = await params;
  return handleReconcileFunding(request, projectId);
}
