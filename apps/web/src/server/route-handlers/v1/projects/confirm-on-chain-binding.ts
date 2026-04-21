import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { confirmOnChainProjectBinding } from "@/server/services/project-service";
import { parseJsonBody } from "@/server/validation/parse";
import { confirmProjectOnChainBindingBodySchema } from "@/server/validation/schemas/project-on-chain-binding";

export async function handleConfirmProjectOnChainBinding(
  request: Request,
  projectId: string,
): Promise<NextResponse> {
  return handleRoute(request, "api.v1.projects.id.on-chain-binding.post", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "CLIENT");
    const payload = await parseJsonBody(request, confirmProjectOnChainBindingBodySchema);
    const project = await confirmOnChainProjectBinding(
      auth.userId,
      projectId,
      payload.onChainProjectId,
    );
    logger.info("On-chain project binding confirmed", {
      projectId,
      onChainProjectId: payload.onChainProjectId,
      clientUserId: auth.userId,
    });
    return NextResponse.json({ project }, { status: 200 });
  });
}
