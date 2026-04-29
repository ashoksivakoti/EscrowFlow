import { NextResponse } from "next/server";
import { keccak256, stringToHex } from "viem";

import { canonicalDeployment } from "@/lib/contracts/contract-addresses";
import { prisma } from "@/lib/prisma";
import { requireAuthenticated } from "@/server/guards/auth-guard";

export const runtime = "nodejs";

const DEFAULT_ADMIN_ROLE = `0x${"0".repeat(64)}` as const;
const PAUSER_ROLE = keccak256(stringToHex("PAUSER_ROLE")).toLowerCase();
const ARBITRATOR_ROLE = keccak256(stringToHex("ARBITRATOR_ROLE")).toLowerCase();

export async function GET(request: Request): Promise<NextResponse> {
  await requireAuthenticated(request);

  const chainId = canonicalDeployment.chainId;
  const contractAddress = canonicalDeployment.contracts.EscrowFlowRegistry.toLowerCase();

  const [activeMemberships, arbitratorState, thresholdHistory] = await Promise.all([
    prisma.roleMembershipState.findMany({
      where: {
        chainId,
        contractAddress,
        role: { in: [DEFAULT_ADMIN_ROLE.toLowerCase(), PAUSER_ROLE.toLowerCase(), ARBITRATOR_ROLE.toLowerCase()] },
        isActive: true,
      },
      select: {
        role: true,
        account: true,
        lastUpdatedBlock: true,
        lastUpdatedTxHash: true,
      },
      orderBy: [{ role: "asc" }, { account: "asc" }],
    }),
    prisma.arbitratorGovernanceState.findUnique({
      where: {
        chainId_contractAddress: {
          chainId,
          contractAddress,
        },
      },
      select: {
        arbitratorCount: true,
        arbitratorThreshold: true,
        lastUpdatedBlock: true,
        lastUpdatedTxHash: true,
      },
    }),
    prisma.arbitratorThresholdHistory.findMany({
      where: { chainId, contractAddress },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: 25,
      select: {
        previousThreshold: true,
        newThreshold: true,
        updatedBy: true,
        txHash: true,
        blockNumber: true,
        logIndex: true,
      },
    }),
  ]);

  const membershipsByRole = {
    DEFAULT_ADMIN_ROLE: activeMemberships
      .filter((row) => row.role === DEFAULT_ADMIN_ROLE.toLowerCase())
      .map((row) => row.account),
    PAUSER_ROLE: activeMemberships
      .filter((row) => row.role === PAUSER_ROLE.toLowerCase())
      .map((row) => row.account),
    ARBITRATOR_ROLE: activeMemberships
      .filter((row) => row.role === ARBITRATOR_ROLE.toLowerCase())
      .map((row) => row.account),
  };

  return NextResponse.json({
    memberships: membershipsByRole,
    arbitrator: {
      count: arbitratorState?.arbitratorCount ?? membershipsByRole.ARBITRATOR_ROLE.length,
      threshold: arbitratorState?.arbitratorThreshold?.toString() ?? null,
      lastUpdatedBlock: arbitratorState?.lastUpdatedBlock?.toString() ?? null,
      lastUpdatedTxHash: arbitratorState?.lastUpdatedTxHash ?? null,
    },
    thresholdHistory: thresholdHistory.map((row) => ({
      previousThreshold: row.previousThreshold.toString(),
      newThreshold: row.newThreshold.toString(),
      updatedBy: row.updatedBy,
      txHash: row.txHash,
      blockNumber: row.blockNumber.toString(),
      logIndex: row.logIndex,
    })),
  });
}
