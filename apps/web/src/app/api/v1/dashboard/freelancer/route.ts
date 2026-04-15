import type { NextResponse } from "next/server";

import { handleGetFreelancerDashboard } from "@/server/route-handlers/v1/dashboard/freelancer";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleGetFreelancerDashboard(request);
}
