import { NextResponse } from "next/server";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { requireRoles } from "@/server/guards/authorization-guard";
import { handleRoute } from "@/server/http/route-handler";
import { listAdminDisputes } from "@/server/services/admin-dispute-service";
import { parseWithSchema } from "@/server/validation/parse";
import { listAdminDisputesQuerySchema } from "@/server/validation/schemas/admin-disputes";

export async function handleListAdminDisputes(request: Request): Promise<NextResponse> {
  return handleRoute(request, "api.v1.admin.disputes.list.get", async ({ logger }) => {
    const auth = await requireAuthenticated(request);
    requireRoles(auth.session, "ADMIN");

    const url = new URL(request.url);
    const parsed = parseWithSchema(
      {
        status: url.searchParams.get("status") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      },
      listAdminDisputesQuerySchema,
    );

    const response = await listAdminDisputes(parsed);
    logger.info("Admin disputes list fetched", {
      userId: auth.userId,
      count: response.items.length,
      status: parsed.status ?? "open",
    });

    return NextResponse.json(response);
  });
}
