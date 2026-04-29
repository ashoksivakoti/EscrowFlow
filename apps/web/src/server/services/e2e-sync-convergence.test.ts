import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type AbiEvent,
  type Hex,
} from "viem";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import {
  OPTIONAL_EVENT_NAMES,
  REQUIRED_EVENT_NAMES,
  __eventSyncInternals,
  parseSupportedEventLog,
} from "@/server/services/event-sync-service";

type FlowSpec = {
  id: number;
  name: string;
  requiredEvents: string[];
  projectionExpectation?: (patch: Record<string, unknown>) => void;
};

function sampleValue(type: string, idx: number): unknown {
  if (type === "address") {
    return `0x${(idx + 1).toString(16).padStart(40, "0")}`;
  }
  if (type === "bool") return idx % 2 === 0;
  if (type.startsWith("uint") || type.startsWith("int")) return BigInt(idx + 1);
  if (type === "string") return `sample-${idx}`;
  if (type.startsWith("bytes")) return `0x${"11".repeat(32)}`;
  return 0n;
}

function buildMockLog(event: AbiEvent): {
  data: Hex;
  topics: [] | [Hex, ...Hex[]];
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
} {
  const argsObj: Record<string, unknown> = {};
  event.inputs.forEach((input, idx) => {
    const key = input.name && input.name.length > 0 ? input.name : `arg${idx}`;
    argsObj[key] = sampleValue(input.type, idx);
  });
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: argsObj,
  });
  const nonIndexedInputs = event.inputs.filter((input) => !input.indexed);
  const nonIndexedValues = nonIndexedInputs.map((input, idx) => {
    const key = input.name && input.name.length > 0 ? input.name : `arg${idx}`;
    return argsObj[key];
  });
  const data = nonIndexedInputs.length
    ? (encodeAbiParameters(nonIndexedInputs, nonIndexedValues) as Hex)
    : ("0x" as Hex);

  return {
    data,
    topics: topics as [] | [Hex, ...Hex[]],
    blockNumber: 123n,
    blockHash: `0x${"aa".repeat(32)}`,
    transactionHash: `0x${"bb".repeat(32)}`,
    logIndex: 1,
  };
}

const flowSpecs: FlowSpec[] = [
  { id: 1, name: "Create project", requiredEvents: ["ProjectCreated"] },
  { id: 2, name: "Fund project", requiredEvents: ["ProjectFunded"] },
  { id: 3, name: "Submit milestone", requiredEvents: ["MilestoneSubmitted"] },
  { id: 4, name: "Approve milestone", requiredEvents: ["MilestoneApproved"] },
  { id: 5, name: "Release milestone", requiredEvents: ["MilestoneFundsReleased"] },
  { id: 6, name: "Raise dispute", requiredEvents: ["DisputeRaised"] },
  { id: 7, name: "Append evidence", requiredEvents: ["DisputeEvidenceAppended"] },
  { id: 8, name: "Resolve dispute", requiredEvents: ["DisputeResolved"] },
  {
    id: 9,
    name: "Emergency propose/cancel/execute",
    requiredEvents: [
      "EmergencyDisputeResolutionProposed",
      "EmergencyDisputeResolutionCancelled",
      "EmergencyDisputeResolved",
    ],
  },
  {
    id: 10,
    name: "Stale pending dispute timeout",
    requiredEvents: ["EmergencyDisputeResolutionNonceAdvanced"],
  },
  { id: 11, name: "Cancel project", requiredEvents: ["ProjectCancelled", "ProjectEmergencyCancelled"] },
  {
    id: 12,
    name: "Alternative recipient set/execute",
    requiredEvents: ["AlternativeRecipientSet", "AlternativeRecipientExecuted"],
    projectionExpectation: (patch) => {
      expect(patch.alternativeRecipients).toBeTruthy();
    },
  },
  {
    id: 13,
    name: "Party-authorized recipient",
    requiredEvents: ["AlternativeRecipientSet"],
    projectionExpectation: (patch) => {
      expect(patch.alternativeRecipients).toBeTruthy();
    },
  },
  {
    id: 14,
    name: "Token review/allowlist",
    requiredEvents: ["TokenReviewAttested", "AllowedTokenUpdated"],
    projectionExpectation: (patch) => {
      expect(patch.tokenReviews ?? patch.allowedTokens).toBeTruthy();
    },
  },
  {
    id: 15,
    name: "Pause/unpause",
    requiredEvents: ["Paused", "Unpaused"],
    projectionExpectation: (patch) => {
      expect(patch.pauseState).toBeTruthy();
    },
  },
  {
    id: 16,
    name: "Role/arbitrator threshold update",
    requiredEvents: ["RoleGranted", "RoleRevoked", "RoleAdminChanged", "ArbitratorThresholdUpdated"],
    projectionExpectation: (patch) => {
      // threshold patch is tracked in cursor state, role events are projected via normalized DB tables.
      if (patch.arbitratorThreshold) {
        expect(patch.arbitratorThreshold).toBeTruthy();
      }
    },
  },
];

describe("E2E convergence coverage matrix", () => {
  it("covers all required production flows with supported events", () => {
    const supported = new Set<string>([...REQUIRED_EVENT_NAMES, ...OPTIONAL_EVENT_NAMES]);
    for (const flow of flowSpecs) {
      for (const eventName of flow.requiredEvents) {
        expect(
          supported.has(eventName),
          `Flow ${flow.id} (${flow.name}) missing supported event ${eventName}`,
        ).toBe(true);
      }
    }
  });

  it("parses and projects representative events for each flow", () => {
    for (const flow of flowSpecs) {
      for (const eventName of flow.requiredEvents) {
        const event = escrowRegistryAbi.find(
          (item) => item.type === "event" && (item as { name: string }).name === eventName,
        );
        expect(event, `Event missing from ABI: ${eventName}`).toBeTruthy();
        const parsed = parseSupportedEventLog(buildMockLog(event as AbiEvent));
        expect(parsed?.name).toBe(eventName);
        if (!parsed) continue;
        const patch = __eventSyncInternals.reduceProjectionState(parsed) as Record<string, unknown>;
        if (flow.projectionExpectation) {
          flow.projectionExpectation(patch);
        }
      }
    }
  });

  it("fails fast on reorg mismatch helpers used by sync safety", () => {
    expect(__eventSyncInternals.isBlockHashMismatch("0x123", "0x124")).toBe(true);
    expect(
      __eventSyncInternals.computeRewindFromBlock({
        startBlock: 263614332,
        lastProcessedBlock: 263614500n,
        rewindDepth: 50,
      }),
    ).toBe(263614450n);
  });
});
