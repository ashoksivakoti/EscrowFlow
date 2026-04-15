import { z } from "zod";

const base64Schema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9+/=]+$/, "fileBase64 must be base64 content");

const disputeEvidenceFileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  fileBase64: base64Schema,
});

export const createMilestoneDisputeBodySchema = z.object({
  reason: z.string().trim().min(10).max(5_000),
  files: z.array(disputeEvidenceFileSchema).min(1, "At least one evidence file is required"),
  relatedSubmissionId: z.string().trim().min(1).nullable().optional(),
});

export type CreateMilestoneDisputeBody = z.infer<typeof createMilestoneDisputeBodySchema>;
