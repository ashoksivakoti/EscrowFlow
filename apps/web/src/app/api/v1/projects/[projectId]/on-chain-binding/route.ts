import type { NextResponse } from "next/server";

import { handleConfirmProjectOnChainBinding } from "@/server/route-handlers/v1/projects/confirm-on-chain-binding";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const { projectId } = await params;
  return handleConfirmProjectOnChainBinding(request, projectId);
}
