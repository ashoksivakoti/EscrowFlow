import type { NextResponse } from "next/server";
import { handleGetSiweNonce } from "@/server/route-handlers/v1/auth/nonce";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  return handleGetSiweNonce(request);
}
