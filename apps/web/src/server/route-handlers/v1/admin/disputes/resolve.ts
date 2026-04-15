import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { resolveDisputeAsAdmin } from "@/server/services/admin-dispute-service";
import { parseJsonBody } from "@/server/validation/parse";
import { resolveDisputeBodySchema } from "@/server/validation/schemas/admin-disputes";

export async function handleResolveDispute(
  request: Request,
  disputeId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.admin.disputes.resolve.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "ADMIN");
    const payload = await parseJsonBody(request, resolveDisputeBodySchema);
    const response = await resolveDisputeAsAdmin({
      disputeId,
      adminUserId: auth.userId,
      payload,
    });

    logger.info("Dispute resolved by admin", {
      userId: auth.userId,
      disputeId,
      kind: payload.kind,
      txHash: payload.resolutionTxHash ?? null,
    });

    return NextResponse.json(response);
  });
}
