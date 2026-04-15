import { z } from "zod";

const base64Schema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9+/=]+$/, "fileBase64 must be base64 content");

const submissionFileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  fileBase64: base64Schema,
});

export const createMilestoneSubmissionBodySchema = z.object({
  note: z.string().trim().min(1).max(5_000).nullable().optional(),
  externalLink: z.string().trim().url().max(2_000).nullable().optional(),
  files: z.array(submissionFileSchema).min(1, "At least one deliverable file is required"),
});

export type CreateMilestoneSubmissionBody = z.infer<
  typeof createMilestoneSubmissionBodySchema
>;
