import { NextResponse } from "next/server";
import type { CompleteOnboardingResponse } from "@escrowflow/types";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { completeOnboarding } from "@/server/services/user-service";
import { parseJsonBody } from "@/server/validation/parse";
import { completeOnboardingBodySchema } from "@/server/validation/schemas/users";

export async function handlePostOnboarding(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.users.me.onboarding.post", async () => {
    const auth = await requireAuthenticated(request);
    const payload = await parseJsonBody(request, completeOnboardingBodySchema);
    const user = await completeOnboarding(auth.userId, payload);
    const body: CompleteOnboardingResponse = { user };
    return NextResponse.json(body, { status: 201 });
  });
}
