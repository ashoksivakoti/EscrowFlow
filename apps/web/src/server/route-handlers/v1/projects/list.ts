import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { handleRoute } from "@/server/http/route-handler";
import { listProjectsForUser } from "@/server/services/project-service";
import { listProjectsQuerySchema } from "@/server/validation/schemas/projects";

export async function handleListProjects(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.get", async () => {
    const auth = await requireAuthenticated(request);
    const url = new URL(request.url);
    const rawParams = Object.fromEntries(url.searchParams.entries());
    const statusValues = url.searchParams.getAll("status");
    const payload = listProjectsQuerySchema.parse({
      ...rawParams,
      ...(statusValues.length > 0 ? { status: statusValues } : {}),
    });
    const response = await listProjectsForUser(auth.userId, payload);
    return NextResponse.json(response);
  });
}
