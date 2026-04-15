import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { buildFreelancerDashboard } from "@/server/services/dashboard-service";

export async function handleGetFreelancerDashboard(
  request: Request,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.dashboard.freelancer.get", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "FREELANCER");
    const dashboard = await buildFreelancerDashboard(auth.userId);
    logger.info("Freelancer dashboard fetched", {
      userId: auth.userId,
      activeProjects: dashboard.summary.activeProjectsCount,
      pendingActions: dashboard.summary.pendingActionsCount,
    });
    return NextResponse.json({ dashboard });
  });
}
