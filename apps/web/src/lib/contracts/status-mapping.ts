import type { MilestoneStatus, ProjectStatus } from "@escrowflow/types";

export type ContractProjectStatus =
  | "Active"
  | "Disputed"
  | "Completed"
  | "Cancelled";
export type ContractMilestoneStatus =
  | "Pending"
  | "Submitted"
  | "Approved"
  | "Released"
  | "Refunded";

export type GuardReason =
  | "PROJECT_STATUS_BLOCKED"
  | "MILESTONE_STATUS_BLOCKED"
  | "MILESTONE_DISPUTED"
  | "NOT_PROJECT_PARTY"
  | "NOT_STALE_DISPUTE"
  | "PREVIOUS_MILESTONE_BLOCKED";

export type GuardResult = { allowed: boolean; reason: GuardReason | null };

type MilestoneOrderState = {
  sortOrder: number;
  status: string;
};

export function mapProjectStatusToContract(
  status: ProjectStatus | string,
): ContractProjectStatus | null {
  if (status === "ACTIVE" || status === "ON_HOLD") {
    return "Active";
  }
  if (status === "DISPUTED") {
    return "Disputed";
  }
  if (status === "COMPLETED") {
    return "Completed";
  }
  if (status === "CANCELLED") {
    return "Cancelled";
  }
  return null;
}

export function mapMilestoneStatusToContract(
  status: MilestoneStatus | string,
): ContractMilestoneStatus {
  if (status === "SUBMITTED" || status === "CLIENT_REVIEW" || status === "DISPUTED") {
    return "Submitted";
  }
  if (status === "APPROVED") {
    return "Approved";
  }
  if (status === "RELEASED") {
    return "Released";
  }
  if (status === "VOIDED") {
    return "Refunded";
  }
  return "Pending";
}

export function formatProjectStatusLabel(status: ProjectStatus | string): string {
  const mapped = mapProjectStatusToContract(status);
  if (mapped) {
    return mapped;
  }
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function formatMilestoneStatusLabel(status: MilestoneStatus | string): string {
  return mapMilestoneStatusToContract(status);
}

function previousMilestonesSettled(
  milestones: MilestoneOrderState[],
  currentSortOrder: number,
): boolean {
  return milestones
    .filter((m) => m.sortOrder < currentSortOrder)
    .every((m) => {
      const mapped = mapMilestoneStatusToContract(m.status);
      return mapped === "Released" || mapped === "Refunded";
    });
}

export function canSubmitMilestone(input: {
  projectStatus: ProjectStatus | string;
  milestoneStatus: MilestoneStatus | string;
  milestoneOpenDisputeId: string | null;
  currentSortOrder: number;
  milestones: MilestoneOrderState[];
  isProjectParty: boolean;
}): GuardResult {
  if (!input.isProjectParty) {
    return { allowed: false, reason: "NOT_PROJECT_PARTY" };
  }
  const project = mapProjectStatusToContract(input.projectStatus);
  if (!project || (project !== "Active" && project !== "Disputed")) {
    return { allowed: false, reason: "PROJECT_STATUS_BLOCKED" };
  }
  if (input.milestoneOpenDisputeId) {
    return { allowed: false, reason: "MILESTONE_DISPUTED" };
  }
  if (!previousMilestonesSettled(input.milestones, input.currentSortOrder)) {
    return { allowed: false, reason: "PREVIOUS_MILESTONE_BLOCKED" };
  }
  return mapMilestoneStatusToContract(input.milestoneStatus) === "Pending"
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "MILESTONE_STATUS_BLOCKED" };
}

export function canApproveMilestone(input: {
  projectStatus: ProjectStatus | string;
  milestoneStatus: MilestoneStatus | string;
  milestoneOpenDisputeId: string | null;
  currentSortOrder: number;
  milestones: MilestoneOrderState[];
  isProjectParty: boolean;
}): GuardResult {
  if (!input.isProjectParty) {
    return { allowed: false, reason: "NOT_PROJECT_PARTY" };
  }
  const project = mapProjectStatusToContract(input.projectStatus);
  if (!project || (project !== "Active" && project !== "Disputed")) {
    return { allowed: false, reason: "PROJECT_STATUS_BLOCKED" };
  }
  if (input.milestoneOpenDisputeId) {
    return { allowed: false, reason: "MILESTONE_DISPUTED" };
  }
  if (!previousMilestonesSettled(input.milestones, input.currentSortOrder)) {
    return { allowed: false, reason: "PREVIOUS_MILESTONE_BLOCKED" };
  }
  return mapMilestoneStatusToContract(input.milestoneStatus) === "Submitted"
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "MILESTONE_STATUS_BLOCKED" };
}

export function canReleaseMilestone(input: {
  projectStatus: ProjectStatus | string;
  milestoneStatus: MilestoneStatus | string;
  milestoneOpenDisputeId: string | null;
  currentSortOrder: number;
  milestones: MilestoneOrderState[];
  isProjectParty: boolean;
}): GuardResult {
  if (!input.isProjectParty) {
    return { allowed: false, reason: "NOT_PROJECT_PARTY" };
  }
  const project = mapProjectStatusToContract(input.projectStatus);
  if (!project || (project !== "Active" && project !== "Disputed")) {
    return { allowed: false, reason: "PROJECT_STATUS_BLOCKED" };
  }
  if (input.milestoneOpenDisputeId) {
    return { allowed: false, reason: "MILESTONE_DISPUTED" };
  }
  if (!previousMilestonesSettled(input.milestones, input.currentSortOrder)) {
    return { allowed: false, reason: "PREVIOUS_MILESTONE_BLOCKED" };
  }
  return mapMilestoneStatusToContract(input.milestoneStatus) === "Approved"
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "MILESTONE_STATUS_BLOCKED" };
}

export function canRaiseDispute(input: {
  projectStatus: ProjectStatus | string;
  milestoneStatus: MilestoneStatus | string;
  milestoneOpenDisputeId: string | null;
  isProjectParty: boolean;
}): GuardResult {
  if (!input.isProjectParty) {
    return { allowed: false, reason: "NOT_PROJECT_PARTY" };
  }
  const project = mapProjectStatusToContract(input.projectStatus);
  if (!project || (project !== "Active" && project !== "Disputed")) {
    return { allowed: false, reason: "PROJECT_STATUS_BLOCKED" };
  }
  if (input.milestoneOpenDisputeId) {
    return { allowed: false, reason: "MILESTONE_DISPUTED" };
  }
  const status = mapMilestoneStatusToContract(input.milestoneStatus);
  if (status === "Submitted" || status === "Approved") {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: "MILESTONE_STATUS_BLOCKED" };
}

export function canResolveStaleDispute(input: {
  projectStatus: ProjectStatus | string;
  milestoneStatus: MilestoneStatus | string;
  milestoneOpenDisputeId: string | null;
}): GuardResult {
  if (!input.milestoneOpenDisputeId) {
    return { allowed: false, reason: "NOT_STALE_DISPUTE" };
  }
  const project = mapProjectStatusToContract(input.projectStatus);
  if (!project || (project !== "Active" && project !== "Disputed")) {
    return { allowed: false, reason: "PROJECT_STATUS_BLOCKED" };
  }
  const status = mapMilestoneStatusToContract(input.milestoneStatus);
  if (status === "Released" || status === "Refunded") {
    return { allowed: false, reason: "MILESTONE_STATUS_BLOCKED" };
  }
  return { allowed: true, reason: null };
}

export function canCancelProject(input: {
  projectStatus: ProjectStatus | string;
  milestones: MilestoneOrderState[];
  hasOpenDispute: boolean;
}): GuardResult {
  const project = mapProjectStatusToContract(input.projectStatus);
  if (!project || project !== "Active") {
    return { allowed: false, reason: "PROJECT_STATUS_BLOCKED" };
  }
  if (input.hasOpenDispute) {
    return { allowed: false, reason: "MILESTONE_DISPUTED" };
  }
  const allPending = input.milestones.every(
    (m) => mapMilestoneStatusToContract(m.status) === "Pending",
  );
  return allPending
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "MILESTONE_STATUS_BLOCKED" };
}

export function guardReasonMessage(reason: GuardReason | null): string | null {
  if (!reason) return null;
  if (reason === "PREVIOUS_MILESTONE_BLOCKED") {
    return "Blocked by previous milestone: complete earlier milestones first.";
  }
  if (reason === "PROJECT_STATUS_BLOCKED") {
    return "Action is not allowed for the current project status.";
  }
  if (reason === "MILESTONE_STATUS_BLOCKED") {
    return "Action is not allowed for the current milestone status.";
  }
  if (reason === "MILESTONE_DISPUTED") {
    return "Action is blocked while this milestone has an active dispute.";
  }
  if (reason === "NOT_PROJECT_PARTY") {
    return "Only project participants can perform this action.";
  }
  return "No stale dispute is available to resolve.";
}
