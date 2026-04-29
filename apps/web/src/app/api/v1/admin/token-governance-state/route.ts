import { NextResponse } from "next/server";
import { z } from "zod";

import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { prisma } from "@/lib/prisma";
import { requireAuthenticated } from "@/server/guards/auth-guard";

const querySchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/),
});

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  await requireAuthenticated(request);
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    token: url.searchParams.get("token"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const token = parsed.data.token.toLowerCase();
  const row = await prisma.tokenGovernanceState.findUnique({
    where: {
      chainId_contractAddress_token: {
        chainId: canonicalDeployment.chainId,
        contractAddress: canonicalDeployment.contracts.EscrowFlowRegistry.toLowerCase(),
        token,
      },
    },
    select: {
      token: true,
      reviewed: true,
      allowed: true,
      reviewedBy: true,
      lastUpdatedTxHash: true,
      lastUpdatedBlock: true,
    },
  });

  return NextResponse.json({
    token,
    reviewed: row?.reviewed ?? false,
    allowed: row?.allowed ?? false,
    reviewedBy: row?.reviewedBy ?? null,
    lastUpdatedTxHash: row?.lastUpdatedTxHash ?? null,
    lastUpdatedBlock: row?.lastUpdatedBlock?.toString() ?? null,
  });
}
