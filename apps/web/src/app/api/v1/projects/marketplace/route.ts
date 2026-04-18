import type { NextResponse } from "next/server";

import { handleCreateMarketplaceProject } from "@/server/route-handlers/v1/projects/marketplace-create";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  return handleCreateMarketplaceProject(request);
}
