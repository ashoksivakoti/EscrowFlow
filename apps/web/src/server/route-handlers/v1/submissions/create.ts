import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { createMilestoneSubmissionForFreelancer } from "@/server/services/submission-service";
import { parseJsonBody } from "@/server/validation/parse";
import { createMilestoneSubmissionBodySchema } from "@/server/validation/schemas/submissions";

export async function handleCreateMilestoneSubmission(
  request: Request,
  projectId: string,
  milestoneId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.milestones.submissions.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "FREELANCER");
    const payload = await parseJsonBody(request, createMilestoneSubmissionBodySchema);
    const response = await createMilestoneSubmissionForFreelancer({
      projectId,
      milestoneId,
      freelancerUserId: auth.userId,
      payload,
    });

    logger.info("Milestone submission created", {
      projectId,
      milestoneId,
      submissionId: response.submission.id,
      freelancerUserId: auth.userId,
      attemptNumber: response.submission.attemptNumber,
    });

    return NextResponse.json(response, { status: 201 });
  });
}
