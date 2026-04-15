import type { NextResponse } from "next/server";
import { handlePostOnboarding } from "@/server/route-handlers/v1/users/onboarding";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  return handlePostOnboarding(request);
}
