import { NextResponse } from "next/server";

import { handleRoute } from "@/server/http/route-handler";
import { buildLogoutResponse } from "@/server/services/auth-service";

export async function handlePostLogout(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.auth.logout.post", async () => {
    const { payload, setCookie } = buildLogoutResponse();
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Set-Cookie": setCookie },
    });
  });
}
