import { NextResponse } from "next/server";

import { handleRoute } from "@/server/http/route-handler";
import { listPublicMarketplaceProjects } from "@/server/services/project-service";
import { parseWithSchema } from "@/server/validation/parse";
import { listPublicProjectsQuerySchema } from "@/server/validation/schemas/marketplace";

export async function handleListPublicProjects(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.public.get", async () => {
    const url = new URL(request.url);
    const rawParams = Object.fromEntries(url.searchParams.entries());
    const query = parseWithSchema(rawParams, listPublicProjectsQuerySchema);
    const data = await listPublicMarketplaceProjects(query);
    return NextResponse.json(data);
  });
}
