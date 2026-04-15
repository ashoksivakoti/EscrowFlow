import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { createMilestoneDisputeForParticipant } from "@/server/services/dispute-service";
import { parseJsonBody } from "@/server/validation/parse";
import { createMilestoneDisputeBodySchema } from "@/server/validation/schemas/disputes";

export async function handleCreateMilestoneDispute(
  request: Request,
  projectId: string,
  milestoneId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.milestones.disputes.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    const payload = await parseJsonBody(request, createMilestoneDisputeBodySchema);
    const response = await createMilestoneDisputeForParticipant({
      projectId,
      milestoneId,
      openedByUserId: auth.userId,
      payload,
    });

    logger.info("Milestone dispute created", {
      projectId,
      milestoneId,
      disputeId: response.dispute.id,
      openedByUserId: auth.userId,
    });

    return NextResponse.json(response, { status: 201 });
  });
}
