import { encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";
import {
  decodeEscrowRegistryError,
  formatEscrowRegistryWriteError,
} from "@/lib/contracts/decode-error";

describe("decodeEscrowRegistryError", () => {
  it("decodes known custom errors from encoded revert data", () => {
    const revertData = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "InsufficientEscrowLiquidity",
    });

    const decoded = decodeEscrowRegistryError({
      cause: {
        data: revertData,
      },
    });

    expect(decoded).toBe("Escrow contract balance is insufficient for this action.");
  });

  it("decodes known custom error names from error message text", () => {
    const err = new Error("ContractFunctionRevertedError: NotProjectClient");
    expect(decodeEscrowRegistryError(err)).toBe(
      "Only the project client can perform this action.",
    );
  });

  it("decodes stale dispute timeout errors", () => {
    const timeoutNotReached = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "DisputeTimeoutNotReached",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: timeoutNotReached },
      }),
    ).toBe("The dispute timeout has not been reached yet.");

    const staleOnlyForPending = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "StaleDisputeTimeoutOnlyForPendingMilestone",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: staleOnlyForPending },
      }),
    ).toBe("This stale-dispute timeout resolution only applies to pending milestones.");
  });

  it("decodes pause/unpause errors", () => {
    const enforcedPause = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "EnforcedPause",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: enforcedPause },
      }),
    ).toBe("This operation is blocked while the contract is paused.");

    const expectedPause = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "ExpectedPause",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: expectedPause },
      }),
    ).toBe("The contract is not currently paused.");
  });

  it("decodes access control errors for role checks", () => {
    const unauth = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "AccessControlUnauthorizedAccount",
      args: [
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ] as const,
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: unauth },
      }),
    ).toBe("Wallet does not have required role to perform this action.");
  });

  it("decodes role confirmation errors for pause/unpause flows", () => {
    const badConfirmation = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "AccessControlBadConfirmation",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: badConfirmation },
      }),
    ).toBe("Role confirmation is invalid for this operation.");
  });

  it("decodes DisputeNotActive", () => {
    const err = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "DisputeNotActive",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: err },
      }),
    ).toBe("No active dispute exists for this milestone.");
  });

  it("decodes cancelProject blocked errors", () => {
    const activeDispute = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "CannotCancelWithActiveDispute",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: activeDispute },
      }),
    ).toBe("Project cancellation is blocked while an active dispute cannot be cleared.");

    const inReview = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "CannotCancelWithInReviewMilestone",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: inReview },
      }),
    ).toBe("Project cancellation is blocked because a submitted milestone is still in review.");

    const approved = encodeErrorResult({
      abi: escrowRegistryAbi,
      errorName: "CannotCancelApprovedMilestone",
    });
    expect(
      decodeEscrowRegistryError({
        cause: { data: approved },
      }),
    ).toBe("Approved milestones cannot be cancelled.");
  });

  it("returns named fallback for unknown errors", () => {
    const out = formatEscrowRegistryWriteError(
      new Error("Random transport issue"),
      "Funding transaction failed",
    );
    expect(out).toBe("Random transport issue");
  });

  it("uses provided fallback when no error details are available", () => {
    const out = formatEscrowRegistryWriteError(null, "Transaction failed");
    expect(out).toBe("Transaction failed");
  });
});
