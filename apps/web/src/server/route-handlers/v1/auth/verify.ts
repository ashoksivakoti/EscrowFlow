import { NextResponse } from "next/server";

import { handleRoute } from "@/server/http/route-handler";
import { verifySiweAndBuildSession } from "@/server/services/auth-service";
import { parseJsonBody } from "@/server/validation/parse";
import { siweVerifyBodySchema } from "@/server/validation/schemas/auth";

export async function handlePostSiweVerify(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.auth.siwe.verify.post", async () => {
    const payload = await parseJsonBody(request, siweVerifyBodySchema);
    const result = await verifySiweAndBuildSession(payload.message, payload.signature);
    return NextResponse.json(result.payload, {
      status: 200,
      headers: { "Set-Cookie": result.setCookie },
    });
  });
}
