import { NextResponse } from "next/server";

import { z } from "zod";

import { requireAuthenticated } from "@/server/guards/auth-guard";
import { prisma } from "@/lib/prisma";
import { canonicalDeployment } from "@/lib/contracts/contract-addresses";

const CLEAR_EVENT_NAMES = new Set([
  "DisputeResolved",
  "EmergencyDisputeResolved",
  "ProjectCancelled",
  "ProjectEmergencyCancelled",
] as const);

const SET_EVENT_NAME = "AlternativeRecipientSet" as const;
const EXEC_EVENT_NAME = "AlternativeRecipientExecuted" as const;

const querySchema = z.object({
  onChainProjectId: z.string().trim().min(1),
  milestoneIndex: z.coerce.number().int().nonnegative(),
  isFreelancer: z.coerce.boolean(),
});

function getArgs(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.args && typeof p.args === "object") return p.args as Record<string, unknown>;
  return p;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (typeof value === "string" && value.trim() !== "" && /^-?\d+$/.test(value.trim())) {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
}

function toAddressLower(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; milestoneId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuthenticated(request);
  void auth;
  const { projectId } = await params;

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

  const logs = await prisma.transactionLog.findMany({
    where: {
      projectId,
      chainId: canonicalDeployment.chainId,
      eventName: {
        in: ["AlternativeRecipientSet", "AlternativeRecipientExecuted", ...Array.from(CLEAR_EVENT_NAMES)],
      },
      blockNumber: {
        gte: BigInt(canonicalDeployment.deploymentBlock),
      },
    },
    select: { eventName: true, payload: true, blockNumber: true, logIndex: true },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });

  let pendingRecipient: `0x${string}` | null = null;
  let executableAfter: bigint | null = null;
  let activeExecutedRecipient: `0x${string}` | null = null;
  let partyAuthorizedRecipient: `0x${string}` | null = null;

  const clearAlternativeLeg = () => {
    pendingRecipient = null;
    executableAfter = null;
    activeExecutedRecipient = null;
  };

  for (const log of logs) {
    const args = getArgs(log.payload);
    if (!args) continue;

    const eventName = log.eventName;

    if (eventName === SET_EVENT_NAME) {
      const argsProjectId = String(args.projectId ?? args.contractProjectId ?? "");
      if (argsProjectId !== onChainProjectIdStr) continue;
      if (Number(args.milestoneIndex) !== milestoneIndex) continue;
      if (Boolean(args.isFreelancer) !== isFreelancer) continue;

      const recipient = toAddressLower(args.recipient);
      const execAfter = toBigInt(args.executableAfter) ?? 0n;

      // Party authorized is represented by `executableAfter == 0` + `recipient != 0`.
      if (execAfter === 0n) {
        if (recipient && recipient !== (ZERO_ADDRESS as `0x${string}`)) {
          partyAuthorizedRecipient = recipient;
        } else {
          // Arbitrator clear or party clear to 0.
          clearAlternativeLeg();
        }
        continue;
      }

      if (recipient && recipient !== (ZERO_ADDRESS as `0x${string}`)) {
        pendingRecipient = recipient;
        executableAfter = execAfter;
      }
      continue;
    }

    if (eventName === EXEC_EVENT_NAME) {
      const argsProjectId = String(args.projectId ?? args.contractProjectId ?? "");
      if (argsProjectId !== onChainProjectIdStr) continue;
      if (Number(args.milestoneIndex) !== milestoneIndex) continue;
      if (Boolean(args.isFreelancer) !== isFreelancer) continue;

      const recipient = toAddressLower(args.recipient);
      if (recipient && recipient !== (ZERO_ADDRESS as `0x${string}`)) {
        activeExecutedRecipient = recipient;
        pendingRecipient = null;
        executableAfter = null;
      }
      continue;
    }

    if (CLEAR_EVENT_NAMES.has(eventName as never)) {
      const argsProjectId = String(args.projectId ?? args.contractProjectId ?? "");
      if (argsProjectId !== onChainProjectIdStr) continue;
      // Some clear events (e.g. ProjectCancelled) don't include milestoneIndex.
      const argsMilestoneIndex = Number(args.milestoneIndex);
      if (Number.isFinite(argsMilestoneIndex) && argsMilestoneIndex !== milestoneIndex) {
        continue;
      }
      clearAlternativeLeg();
      continue;
    }
  }

  return NextResponse.json({
    pendingRecipient,
    executableAfter: executableAfter ? executableAfter.toString() : null,
    activeExecutedRecipient,
    partyAuthorizedRecipient,
  });
}

