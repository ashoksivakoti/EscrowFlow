import { NextResponse } from "next/server";

import { getEventSyncEnv } from "@/server/event-sync/env";
import { syncEscrowEventsOnce } from "@/server/services/event-sync-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEventSyncEnv();
  const requiredToken = env.EVENT_SYNC_TRIGGER_TOKEN;
  if (requiredToken) {
    const providedToken = request.headers.get("x-event-sync-token");
    if (!providedToken || providedToken !== requiredToken) {
      return NextResponse.json({ error: "Unauthorized event sync trigger" }, { status: 401 });
    }
  }

  const result = await syncEscrowEventsOnce();
  return NextResponse.json({ sync: result });
}
