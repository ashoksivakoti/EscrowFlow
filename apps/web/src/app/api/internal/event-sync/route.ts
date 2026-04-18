import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { getEventSyncEnv } from "@/server/event-sync/env";
import { AppError } from "@/server/errors/app-error";
import { handleRoute } from "@/server/http/route-handler";
import { syncEscrowEventsOnce } from "@/server/services/event-sync-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.internal.event-sync.post", async () => {
    const env = getEventSyncEnv();
    const requiredToken = env.EVENT_SYNC_TRIGGER_TOKEN;
    if (requiredToken) {
      const providedToken = request.headers.get("x-event-sync-token");
      if (!providedToken || !safeTokenEquals(providedToken, requiredToken)) {
        throw AppError.unauthenticated("Unauthorized event sync trigger");
      }
    }

    const result = await syncEscrowEventsOnce();
    return NextResponse.json({ sync: result });
  });
}

function safeTokenEquals(provided: string, required: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const requiredBuffer = Buffer.from(required);
  if (providedBuffer.length !== requiredBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, requiredBuffer);
}
