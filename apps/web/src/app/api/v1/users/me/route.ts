import type { NextResponse } from "next/server";
import { handleGetMe } from "@/server/route-handlers/v1/users/me";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleGetMe(request);
}
