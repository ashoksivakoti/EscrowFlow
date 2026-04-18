import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import {
  applyToProject,
  listProjectApplicationsForClient,
} from "@/server/services/project-application-service";
import { parseJsonBody } from "@/server/validation/parse";
import { createProjectApplicationBodySchema } from "@/server/validation/schemas/project-applications";

/**
 * GET /api/v1/projects/:projectId/applications — client owner lists applications.
 * POST /api/v1/projects/:projectId/applications — freelancer submits one application.
 */
export async function handleListProjectApplications(
  request: Request,
  projectId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.id.applications.get", async () => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "CLIENT");
    const data = await listProjectApplicationsForClient(projectId, auth.userId);
    return NextResponse.json(data);
  });
}

export async function handleCreateProjectApplication(
  request: Request,
  projectId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.id.applications.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "FREELANCER");
    const payload = await parseJsonBody(request, createProjectApplicationBodySchema);
    const data = await applyToProject(projectId, auth.userId, payload);
    logger.info("Project application created", {
      projectId,
      applicationId: data.application.id,
      freelancerUserId: auth.userId,
    });
    return NextResponse.json(data, { status: 201 });
  });
}
