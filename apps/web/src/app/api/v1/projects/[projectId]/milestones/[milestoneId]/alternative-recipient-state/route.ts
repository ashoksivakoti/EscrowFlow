import { NextResponse } from "next/server";

import { z } from "zod";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { prisma } from "@/lib/prisma";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";

const querySchema = z.object({
  onChainProjectId: z.string().trim().min(1),
  milestoneIndex: z.coerce.number().int().nonnegative(),
  isFreelancer: z.coerce.boolean(),
});

export const runtime = "nodejs";

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; milestoneId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuthenticated(request);
  void auth;
  await params;

  const url = new URL(request.url);
  const parse = querySchema.safeParse({
    onChainProjectId: url.searchParams.get("onChainProjectId"),
    milestoneIndex: url.searchParams.get("milestoneIndex"),
    isFreelancer: url.searchParams.get("isFreelancer"),
  });

  if (!parse.success) {
    return NextResponse.json({ error: parse.error.flatten() }, { status: 400 });
  }

  const { onChainProjectId, milestoneIndex, isFreelancer } = parse.data;
  const onChainProjectIdStr = onChainProjectId.trim();

  const normalizedState = await prisma.alternativeRecipientState.findUnique({
    where: {
      chainId: canonicalDeployment.chainId,
      chainId_contractAddress_projectId_milestoneIndex_isFreelancer: {
        chainId: canonicalDeployment.chainId,
        contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry.toLowerCase(),
        projectId: onChainProjectIdStr,
        milestoneIndex,
        isFreelancer,
      },
    },
  });

  return NextResponse.json({
    pendingRecipient: normalizedState?.pendingRecipient ?? null,
    executableAfter: normalizedState?.executableAfter?.toString() ?? null,
    activeExecutedRecipient: normalizedState?.activeRecipient ?? null,
    partyAuthorizedRecipient: normalizedState?.partyAuthorizedRecipient ?? null,
    status: normalizedState?.status ?? "cleared",
    updatedAtBlock: normalizedState?.updatedAtBlock?.toString() ?? null,
    updatedAtTxHash: normalizedState?.updatedAtTxHash ?? null,
  });
}

