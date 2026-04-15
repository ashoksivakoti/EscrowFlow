import type { NextResponse } from "next/server";
import { handleGetSession } from "@/server/route-handlers/v1/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleGetSession(request);
}
