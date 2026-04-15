/**
 * Domain enums for API and UI layers.
 * Values MUST stay in sync with `prisma/schema.prisma` — Prisma remains the DB source of truth.
 */

export const PLATFORM_ROLES = ["ADMIN", "CLIENT", "FREELANCER"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PROJECT_STATUSES = [
  "DRAFT",
  "AWAITING_FREELANCER",
  "AWAITING_ESCROW",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const MILESTONE_STATUSES = [
  "PLANNED",
  "AWAITING_FUNDS",
  "FUNDED",
  "IN_PROGRESS",
  "SUBMITTED",
  "CLIENT_REVIEW",
  "APPROVED",
  "REJECTED",
  "DISPUTED",
  "RELEASED",
  "VOIDED",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const SUBMISSION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const DISPUTE_STATUSES = [
  "OPEN",
  "AWAITING_RESPONSE",
  "UNDER_ADMIN_REVIEW",
  "RESOLVED_CLIENT_FAVOR",
  "RESOLVED_FREELANCER_FAVOR",
  "RESOLVED_SPLIT",
  "DISMISSED",
  "WITHDRAWN",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "SYSTEM",
  "PROJECT",
  "MILESTONE",
  "SUBMISSION",
  "DISPUTE",
  "PAYMENT",
  "REVIEW",
  "MODERATION",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
