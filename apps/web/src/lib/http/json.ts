import { NextResponse } from "next/server";

import type { ApiErrorBody, ApiSuccessEnvelope } from "@escrowflow/types";

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string,
): NextResponse<{ error: ApiErrorBody }> {
  const error: ApiErrorBody = { code, message, details, requestId };
  return NextResponse.json({ error }, { status });
}

export function jsonOk<T>(
  data: T,
  init?: ResponseInit,
): NextResponse<ApiSuccessEnvelope<T>> {
  return NextResponse.json({ data }, init);
}
