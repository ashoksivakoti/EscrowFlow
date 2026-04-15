import { NextResponse } from "next/server";

import { handleRoute } from "@/server/http/route-handler";
import { getSessionResponse } from "@/server/services/auth-service";

export async function handleGetSession(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.auth.session.get", async () => {
    const payload = await getSessionResponse(request);
    return NextResponse.json(payload);
  });
}
