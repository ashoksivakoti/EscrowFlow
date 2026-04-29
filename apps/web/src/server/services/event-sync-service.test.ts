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

function sampleValue(type: string, idx: number): unknown {
  if (type === "address") {
    return `0x${(idx + 1).toString(16).padStart(40, "0")}`;
  }
  if (type === "bool") {
    return idx % 2 === 0;
  }
  if (type.startsWith("uint") || type.startsWith("int")) {
    return BigInt(idx + 1);
  }
  if (type === "string") {
    return `sample-${idx}`;
  }
  if (type.startsWith("bytes")) {
    return `0x${"11".repeat(32)}`;
  }
  return 0n;
}

function buildMockLog(event: AbiEvent): {
  data: Hex;
  topics: Hex[];
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
} {
  const argsObj: Record<string, unknown> = {};
  event.inputs.forEach((input, idx) => {
    argsObj[input.name] = sampleValue(input.type, idx);
  });
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args: argsObj,
  });
  const nonIndexedInputs = event.inputs.filter((input) => !input.indexed);
  const nonIndexedValues = nonIndexedInputs.map((input) => argsObj[input.name]);
  const data = nonIndexedInputs.length
    ? (encodeAbiParameters(nonIndexedInputs, nonIndexedValues) as Hex)
    : ("0x" as Hex);

  return {
    data,
    topics: topics as Hex[],
    blockNumber: 123n,
    blockHash: `0x${"aa".repeat(32)}`,
    transactionHash: `0x${"bb".repeat(32)}`,
    logIndex: 1,
  };
}

describe("event-sync supported event parser", () => {
  it("decodes all required escrow registry events", () => {
    const events = escrowRegistryAbi.filter(
      (item): item is AbiEvent =>
        item.type === "event" && REQUIRED_EVENT_NAMES.includes(item.name as never),
    );
    expect(events.length).toBe(REQUIRED_EVENT_NAMES.length);

    for (const event of events) {
      const parsed = parseSupportedEventLog(buildMockLog(event));
      expect(parsed?.name).toBe(event.name);
    }
  });

  it("decodes optional nonce event when present in ABI", () => {
    const optionalName = OPTIONAL_EVENT_NAMES[0];
    const event = escrowRegistryAbi.find(
      (item): item is AbiEvent => item.type === "event" && item.name === optionalName,
    );
    expect(event).toBeTruthy();
    const parsed = parseSupportedEventLog(buildMockLog(event!));
    expect(parsed?.name).toBe(optionalName);
  });

  it("treats identical event replay as idempotent", () => {
    expect(__eventSyncInternals.shouldApplyProjection("DisputeRaised", "DisputeRaised")).toBe(false);
    expect(__eventSyncInternals.shouldApplyProjection("DisputeRaised", "DisputeResolved")).toBe(true);
  });

  it("merges projection state patches deeply for replay-safe accumulation", () => {
    const merged = __eventSyncInternals.mergeProjectionState(
      {
        alternativeRecipients: {
          "1:0:freelancer": { pendingRecipient: "0xabc", executableAfter: "10" },
        },
      },
      {
        alternativeRecipients: {
          "1:0:freelancer": { executedRecipient: "0xdef" },
        },
      },
    );
    expect(merged).toEqual({
      alternativeRecipients: {
        "1:0:freelancer": {
          pendingRecipient: "0xabc",
          executableAfter: "10",
          executedRecipient: "0xdef",
        },
      },
    });
  });
});
