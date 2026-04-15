import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";
import { ZodError } from "zod";

import { jsonError } from "@/lib/http/json";
import { AppError, isAppError } from "@/server/errors/app-error";
import { createLogger } from "@/server/logging/logger";

type RouteContext = {
  requestId: string;
  logger: ReturnType<typeof createLogger>;
};

export async function handleRoute(
  request: Request,
  routeName: string,
  handler: (ctx: RouteContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const logger = createLogger(routeName, requestId);
  try {
    return await handler({ requestId, logger });
  } catch (error) {
    if (isAppError(error)) {
      logger.warn("Route failed with AppError", {
        code: error.code,
        status: error.status,
      });
      return jsonError(
        error.status,
        error.code,
        error.message,
        error.details,
        requestId,
      );
    }
    if (error instanceof ZodError) {
      logger.warn("Route failed with validation error");
      return jsonError(
        400,
        "VALIDATION_FAILED",
        "Request validation failed",
        { issues: error.flatten() },
        requestId,
      );
    }
    logger.error("Route failed with unexpected error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Unexpected server error",
      undefined,
      requestId,
    );
  }
}

export function asAppError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(code, message, status, details);
}
