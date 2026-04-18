import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth/session";
import { handleRoute } from "@/server/http/route-handler";
import { getPublicProjectDetail } from "@/server/services/project-service";

export async function handleGetPublicProject(
  request: Request,
  projectId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.public.id.get", async () => {
    const session = await getSessionUserFromRequest(request);
    const data = await getPublicProjectDetail(projectId, session?.id ?? null);
    return NextResponse.json(data);
  });
}
