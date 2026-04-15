import { NextResponse } from "next/server";
import type { GetMeResponse } from "@escrowflow/types";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { getCurrentUserOrThrow } from "@/server/services/user-service";

export async function handleGetMe(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.users.me.get", async () => {
    const auth = await requireAuthenticated(request);
    const user = await getCurrentUserOrThrow(auth.userId);
    const body: GetMeResponse = { user };
    return NextResponse.json(body);
  });
}
