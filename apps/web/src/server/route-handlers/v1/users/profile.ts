import { NextResponse } from "next/server";
import type { UpdateMeProfileResponse } from "@escrowflow/types";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { updateCurrentUserProfile } from "@/server/services/user-service";
import { parseJsonBody } from "@/server/validation/parse";
import { patchProfileBodySchema } from "@/server/validation/schemas/users";

export async function handlePatchProfile(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.users.me.profile.patch", async () => {
    const auth = await requireAuthenticated(request);
    const payload = await parseJsonBody(request, patchProfileBodySchema);
    const user = await updateCurrentUserProfile(auth.userId, payload);
    const body: UpdateMeProfileResponse = { user };
    return NextResponse.json(body);
  });
}
