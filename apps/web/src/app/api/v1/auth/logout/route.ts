import type { NextResponse } from "next/server";
import { handlePostLogout } from "@/server/route-handlers/v1/auth/logout";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  return handlePostLogout(request);
}
