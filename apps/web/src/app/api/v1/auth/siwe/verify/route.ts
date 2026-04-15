import type { NextResponse } from "next/server";
import { handlePostSiweVerify } from "@/server/route-handlers/v1/auth/verify";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  return handlePostSiweVerify(request);
}
