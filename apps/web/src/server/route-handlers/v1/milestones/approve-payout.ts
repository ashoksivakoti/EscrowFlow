import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { reconcileMilestoneApprovalAndPayout } from "@/server/services/milestone-review-service";
import { parseJsonBody } from "@/server/validation/parse";
import { approveAndPayoutBodySchema } from "@/server/validation/schemas/milestone-review";

export async function handleApproveMilestoneAndPayout(
  request: Request,
  projectId: string,
  milestoneId: string,
): Promise<NextResponse> {
  return handleRoute(
    request,
    "api.v1.projects.milestones.approvePayout.post",
    async ({ logger }) => {
      const auth = await requireAuthenticated(request);
      requireRoles(auth.session, "CLIENT");
      const payload = await parseJsonBody(request, approveAndPayoutBodySchema);
      const result = await reconcileMilestoneApprovalAndPayout({
        projectId,
        milestoneId,
        clientUserId: auth.userId,
        payload,
      });

      logger.info("Milestone approval and payout reconciled", {
        projectId,
        milestoneId,
        submissionId: payload.submissionId,
        clientUserId: auth.userId,
        releaseTxHash: payload.releaseTxHash,
      });
      return NextResponse.json({ payout: result });
    },
  );
}
