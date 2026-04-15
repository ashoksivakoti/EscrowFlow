import { NextResponse } from "next/server";

import { handleRoute } from "@/server/http/route-handler";
import { issueSiweNoncePayload } from "@/server/services/auth-service";

export async function handleGetSiweNonce(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.auth.siwe.nonce.get", async () => {
    const payload = await issueSiweNoncePayload();
    return NextResponse.json(payload);
  });
}
