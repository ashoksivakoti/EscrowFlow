import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { listProjectsForUser } from "@/server/services/project-service";

export async function handleListProjects(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.get", async () => {
    const auth = await requireAuthenticated(request);
    const response = await listProjectsForUser(auth.userId);
    return NextResponse.json(response);
  });
}
