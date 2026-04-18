import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { withdrawProjectApplication } from "@/server/services/project-application-service";

export async function handleWithdrawApplication(
  request: Request,
  projectId: string,
  applicationId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.id.applications.withdraw.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "FREELANCER");
    await withdrawProjectApplication(projectId, applicationId, auth.userId);
    logger.info("Project application withdrawn", { projectId, applicationId, freelancerUserId: auth.userId });
    return new NextResponse(null, { status: 204 });
  });
}
