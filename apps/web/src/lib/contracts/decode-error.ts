import { decodeErrorResult } from "viem";

import { escrowRegistryAbi } from "@/lib/contracts/escrow-registry-abi.full";

const CUSTOM_ERROR_MESSAGES: Record<string, string> = {
  PreviousMilestoneNotCompleted:
    "Complete the previous milestone before continuing.",
  InsufficientEscrowLiquidity:
    "Escrow contract balance is insufficient for this action.",
  InsufficientFundingForMilestone:
    "Project funding is insufficient for this milestone.",
  NotProjectClient:
    "Only the project client can perform this action.",
  NotProjectFreelancer:
    "Only the assigned freelancer can perform this action.",
  NotProjectParty:
    "Only a project party can perform this action.",
  DisputeActive:
    "This action is blocked while a dispute is active.",
  DisputeNotActive:
    "No active dispute exists for this milestone.",
  DisputeTimeoutNotReached:
    "The dispute timeout has not been reached yet.",
  StaleDisputeTimeoutOnlyForPendingMilestone:
    "This stale-dispute timeout resolution only applies to pending milestones.",
  EnforcedPause:
    "This operation is blocked while the contract is paused.",
  ExpectedPause:
    "The contract is not currently paused.",
  AccessControlUnauthorizedAccount:
    "Wallet does not have required role to perform this action.",
  AccessControlBadConfirmation:
    "Role confirmation is invalid for this operation.",
  CannotCancelWithActiveDispute:
    "Project cancellation is blocked while an active dispute cannot be cleared.",
  CannotCancelWithInReviewMilestone:
    "Project cancellation is blocked because a submitted milestone is still in review.",
  CannotCancelApprovedMilestone:
    "Approved milestones cannot be cancelled.",
  ProjectNotActive:
    "Project is not active for this operation.",
  InvalidMilestoneStatus:
    "Milestone status does not allow this action.",
  InvalidDisputeMilestoneStatus:
    "Milestone status does not allow raising a dispute.",
  AlternativeRecipientChangePending:
    "An alternative recipient change is already pending.",
  MilestoneDeadlineNotReached:
    "Dispute cannot be raised before the milestone deadline.",
  DisputeAlreadyActive:
    "This milestone already has an active dispute.",
  NotAuthorizedToRaiseDispute:
    "Only an authorized project party can raise this dispute.",
  URITooLong:
    "URI exceeds the maximum allowed length.",
  EmergencyResolutionNotReady:
    "Emergency resolution is not ready yet.",
  EmergencyResolutionNotProposed:
    "Emergency resolution has not been proposed.",
  TokenReviewNotAttested:
    "Token review is not attested for this operation.",
  InvalidToken:
    "Token address is invalid for allowlist review.",
  ZeroAddress:
    "Zero address is not allowed for this operation.",
  RoleSeparationViolation:
    "Role separation violation: admin/pauser cannot also be arbitrator.",
  InvalidArbitratorThreshold:
    "Invalid arbitrator threshold for current arbitrator set.",
  InvalidSignature:
    "Signature verification failed.",
  SignatureExpired:
    "Signature has expired. Request a new signature.",
  InvalidAuthorizationNonce:
    "Authorization nonce is invalid or already used.",
};

function maybeHexData(value: unknown): `0x${string}` | null {
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    return value as `0x${string}`;
  }
  return null;
}

function pickKnownMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const text = `${error.name} ${error.message}`;
  for (const [errorName, msg] of Object.entries(CUSTOM_ERROR_MESSAGES)) {
    if (text.includes(errorName)) {
      return msg;
    }
  }
  return null;
}

function collectPossibleHexData(input: unknown, out: Set<`0x${string}`>, depth = 0): void {
  if (depth > 5 || input == null) {
    return;
  }
  const direct = maybeHexData(input);
  if (direct) {
    out.add(direct);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      collectPossibleHexData(item, out, depth + 1);
    }
    return;
  }
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    for (const value of Object.values(obj)) {
      collectPossibleHexData(value, out, depth + 1);
    }
  }
}

export function decodeEscrowRegistryError(error: unknown): string | null {
  const direct = pickKnownMessage(error);
  if (direct) {
    return direct;
  }

  const hexCandidates = new Set<`0x${string}`>();
  collectPossibleHexData(error, hexCandidates);

  for (const data of hexCandidates) {
    try {
      const decoded = decodeErrorResult({
        abi: escrowRegistryAbi,
        data,
      });
      const mapped = CUSTOM_ERROR_MESSAGES[decoded.errorName];
      if (mapped) {
        return mapped;
      }
      return `Transaction reverted: ${decoded.errorName}.`;
    } catch {
      // try next candidate
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }
  return null;
}

export function formatEscrowRegistryWriteError(
  error: unknown,
  fallback: string,
): string {
  return decodeEscrowRegistryError(error) ?? fallback;
}
