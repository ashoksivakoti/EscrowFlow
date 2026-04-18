import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { declineProjectApplication } from "@/server/services/project-application-service";

export async function handleDeclineApplication(
  request: Request,
  projectId: string,
  applicationId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.id.applications.decline.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "CLIENT");
    await declineProjectApplication(projectId, applicationId, auth.userId);
    logger.info("Project application declined", { projectId, applicationId, clientUserId: auth.userId });
    return new NextResponse(null, { status: 204 });
  });
}
