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

describe("event-sync supported event parser", () => {
  it("decodes all required escrow registry events", () => {
    const events = escrowRegistryAbi.filter(
      (item) => item.type === "event" && REQUIRED_EVENT_NAMES.includes((item as { name: string }).name as never),
    );
    expect(events.length).toBe(REQUIRED_EVENT_NAMES.length);

    for (const event of events) {
      const parsed = parseSupportedEventLog(buildMockLog(event as AbiEvent));
      expect(parsed?.name).toBe((event as { name: string }).name);
    }
  });

  it("decodes optional nonce event when present in ABI", () => {
    const optionalName = OPTIONAL_EVENT_NAMES[0];
    const event = escrowRegistryAbi.find(
      (item) => item.type === "event" && (item as { name: string }).name === optionalName,
    );
    expect(event).toBeTruthy();
    const parsed = parseSupportedEventLog(buildMockLog(event as AbiEvent));
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

  it("projects pause-state patches from Paused and Unpaused events", () => {
    const pausedEvent = escrowRegistryAbi.find(
      (item) => item.type === "event" && (item as { name: string }).name === "Paused",
    );
    const unpausedEvent = escrowRegistryAbi.find(
      (item) => item.type === "event" && (item as { name: string }).name === "Unpaused",
    );
    expect(pausedEvent).toBeTruthy();
    expect(unpausedEvent).toBeTruthy();

    const pausedParsed = parseSupportedEventLog(buildMockLog(pausedEvent as AbiEvent));
    const unpausedParsed = parseSupportedEventLog(buildMockLog(unpausedEvent as AbiEvent));
    expect(pausedParsed?.name).toBe("Paused");
    expect(unpausedParsed?.name).toBe("Unpaused");

    const pausedPatch = __eventSyncInternals.reduceProjectionState(pausedParsed!);
    const unpausedPatch = __eventSyncInternals.reduceProjectionState(unpausedParsed!);
    expect(pausedPatch).toEqual({
      pauseState: {
        paused: true,
        account: "0x0000000000000000000000000000000000000001",
        eventName: "Paused",
      },
    });
    expect(unpausedPatch).toEqual({
      pauseState: {
        paused: false,
        account: "0x0000000000000000000000000000000000000001",
        eventName: "Unpaused",
      },
    });
  });

  it("distinguishes synthetic and real chain logs sharing tx hash", () => {
    const chainKey = __eventSyncInternals.transactionLogUniqueKey({
      chainId: 421614,
      txHash: "0xabc123",
      logIndex: 7,
    });
    const syntheticKey = __eventSyncInternals.transactionLogUniqueKey({
      chainId: 421614,
      txHash: "0xabc123",
      logIndex: -1,
    });
    expect(chainKey).not.toBe(syntheticKey);
  });

  it("detects block hash mismatch for reorg validation", () => {
    expect(__eventSyncInternals.isBlockHashMismatch("0xabc", "0xdef")).toBe(true);
    expect(__eventSyncInternals.isBlockHashMismatch("0xabc", "0xAbC")).toBe(false);
    expect(__eventSyncInternals.isBlockHashMismatch(null, "0xdef")).toBe(false);
  });

  it("computes rewind start block with safety floor", () => {
    expect(
      __eventSyncInternals.computeRewindFromBlock({
        startBlock: 100,
        lastProcessedBlock: 180n,
        rewindDepth: 25,
      }),
    ).toBe(155n);

    expect(
      __eventSyncInternals.computeRewindFromBlock({
        startBlock: 100,
        lastProcessedBlock: 110n,
        rewindDepth: 50,
      }),
    ).toBe(100n);
  });
});
