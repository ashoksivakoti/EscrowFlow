import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http/json";

import { AuthError } from "./errors";

export function toAuthRouteErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthError) {
    return jsonError(error.status, error.code, error.message);
  }
  return null;
}
