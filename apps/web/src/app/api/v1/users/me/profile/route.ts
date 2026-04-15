import type { NextResponse } from "next/server";
import { handlePatchProfile } from "@/server/route-handlers/v1/users/profile";

export const runtime = "nodejs";

export async function PATCH(request: Request): Promise<NextResponse> {
  return handlePatchProfile(request);
}
