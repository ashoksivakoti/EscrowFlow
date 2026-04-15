import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { buildClientDashboard } from "@/server/services/dashboard-service";

export async function handleGetClientDashboard(
  request: Request,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.dashboard.client.get", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "CLIENT");
    const dashboard = await buildClientDashboard(auth.userId);
    logger.info("Client dashboard fetched", {
      userId: auth.userId,
      activeProjects: dashboard.summary.activeProjectsCount,
      pendingActions: dashboard.summary.pendingActionsCount,
    });
    return NextResponse.json({ dashboard });
  });
}
