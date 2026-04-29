import { z } from "zod";

const base64Schema = z
  .string()
  .trim()
  .min(1)
  .max(35_000_000, "fileBase64 payload is too large")
  .regex(/^[A-Za-z0-9+/=]+$/, "fileBase64 must be base64 content");

const disputeEvidenceFileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  fileBase64: base64Schema,
});

export const createMilestoneDisputeBodySchema = z.object({
  reason: z.string().trim().min(10).max(5_000),
  reasonUri: z.string().trim().min(1).max(2048),
  chainId: z.coerce.number().int().positive(),
  escrowContractAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "escrowContractAddress must be a valid EVM address")
    .transform((v) => v.toLowerCase()),
  onChainProjectId: z.string().trim().min(1),
  milestoneIndex: z.coerce.number().int().nonnegative(),
  disputeTxHash: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{64}$/, "disputeTxHash must be a valid transaction hash")
    .transform((v) => v.toLowerCase()),
  files: z
    .array(disputeEvidenceFileSchema)
    .min(1, "At least one evidence file is required")
    .max(5, "A maximum of 5 evidence files is allowed"),
  relatedSubmissionId: z.string().trim().min(1).nullable().optional(),
});

export type CreateMilestoneDisputeBody = z.infer<typeof createMilestoneDisputeBodySchema>;
