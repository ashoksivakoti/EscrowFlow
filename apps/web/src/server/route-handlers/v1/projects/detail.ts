import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { getProjectDetailForUser } from "@/server/services/project-service";

export async function handleGetProject(
  request: Request,
  projectId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.id.get", async () => {
    const auth = await requireAuthenticated(request);
    const project = await getProjectDetailForUser(projectId, auth.userId);
    return NextResponse.json({ project });
  });
}
