import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { reconcileProjectFunding } from "@/server/services/funding-service";
import { parseJsonBody } from "@/server/validation/parse";
import { reconcileFundingBodySchema } from "@/server/validation/schemas/funding";

export async function handleReconcileFunding(
  request: Request,
  projectId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.id.funding.post", async () => {
    const auth = await requireAuthenticated(request);
    const payload = await parseJsonBody(request, reconcileFundingBodySchema);
    const result = await reconcileProjectFunding(projectId, auth.userId, payload);
    return NextResponse.json({ funding: result });
  });
}
