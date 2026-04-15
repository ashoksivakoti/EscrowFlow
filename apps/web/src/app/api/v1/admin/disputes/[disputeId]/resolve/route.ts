import type { NextResponse } from "next/server";

import { handleResolveDispute } from "@/server/route-handlers/v1/admin/disputes/resolve";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disputeId: string }> },
): Promise<NextResponse> {
  const { disputeId } = await params;
  return handleResolveDispute(request, disputeId);
}
