import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { createProjectForClient } from "@/server/services/project-service";
import { parseJsonBody } from "@/server/validation/parse";
import { createProjectBodySchema } from "@/server/validation/schemas/projects";

export async function handleCreateProject(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "CLIENT");
    const payload = await parseJsonBody(request, createProjectBodySchema);
    const response = await createProjectForClient(auth.userId, payload);
    logger.info("Project created", {
      projectId: response.project.id,
      clientUserId: auth.userId,
      milestoneCount: response.project.milestoneCount,
    });
    return NextResponse.json(response, { status: 201 });
  });
}
