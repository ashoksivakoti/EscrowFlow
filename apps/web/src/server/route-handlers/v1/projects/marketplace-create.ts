import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { createMarketplaceProjectForClient } from "@/server/services/project-service";
import { parseJsonBody } from "@/server/validation/parse";
import { createMarketplaceProjectBodySchema } from "@/server/validation/schemas/marketplace";

export async function handleCreateMarketplaceProject(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.marketplace.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "CLIENT");
    const payload = await parseJsonBody(request, createMarketplaceProjectBodySchema);
    const response = await createMarketplaceProjectForClient(auth.userId, payload);
    logger.info("Marketplace project created", {
      projectId: response.project.id,
      clientUserId: auth.userId,
    });
    return NextResponse.json(response, { status: 201 });
  });
}
